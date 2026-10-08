/**
 * Hardened page crawler for Stage 2 corpora. Each URL gets a fresh browser context:
 * no downloads, no permissions, no service workers, dialogs dismissed, popups closed, and
 * no requests or WebSockets to private networks. The crawler never clicks or submits anything; it loads
 * the page, lets it settle, and runs the shared extractor.
 *
 * Output per URL under `outDir/<id>/`: record.json, page.html, screenshot.png, plus a line
 * in `outDir/index.jsonl`.
 *
 * Where to run it: crawled pages are live phishing sites running real JavaScript. Run real
 * phish crawls in the hardened container in packages/eval/docker/, not on a machine with anything
 * to protect. All browser traffic goes through egress-proxy.ts, which refuses private
 * addresses and connects only to the address it checked.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import type { Socket } from "node:net";
import path from "node:path";
import { hasSecretSurface, type PageSnapshot } from "@warden/shared/page/extract";
import { registrableDomain } from "@warden/shared/psl";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { startEgressProxy } from "./egress-proxy.ts";
import { extractorScript } from "./extractor-bundle.ts";
import { createHostGuard, type Resolver } from "./network-guard.ts";

export const CRAWL_SCHEMA = 1;
const MAX_HTML = 2_000_000;
/** A current desktop Chrome UA: phishing kits often cloak from headless user agents. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface CrawlTarget {
  url: string;
  label: "benign" | "phish";
  /** Corpus group (benign) or source feed (phish). */
  group: string;
  /** Also collect same-site "sign in" links (benign corpus discovery only). */
  discoverLogin?: boolean;
}

export interface CrawlRecord extends CrawlTarget {
  schema: typeof CRAWL_SCHEMA;
  id: string;
  crawled_at: number;
  ok: boolean;
  error?: string;
  status: number | null;
  final_url: string | null;
  /** Every top-frame URL the page went through, first to last (server and client redirects). */
  chain: string[];
  snapshot: PageSnapshot | null;
  /** True when the snapshot has a secret-entry surface (the Stage 2 gate). */
  gated: boolean;
  /** Same-site login link candidates, best first, when `discoverLogin` was set. */
  login_links?: string[];
  /** Requests the network guard refused (private-network or unresolvable hosts). */
  blocked_requests: number;
  /** Why the guard refused the page's own navigation, when it did. */
  main_frame_refused?: "private" | "unresolved";
  /** 1 for the first try, 2 for the retry. */
  attempt: number;
  duration_ms: number;
}

export interface CrawlerOptions {
  outDir: string;
  /** Navigation timeout; the whole crawl gets this plus `settleMs` and a margin. */
  timeoutMs?: number;
  /** How long to let scripts run after load before extracting. */
  settleMs?: number;
  resolveHost?: Resolver;
  /** Extra Chromium flags. */
  launchArgs?: string[];
  /** Upstream dialer for the egress proxy (tests point it at a local server). */
  dial?: (address: string, port: number) => Socket;
  headless?: boolean;
  /**
   * Chromium's own sandbox. On by default (Playwright turns it off unless asked): it is the
   * main barrier between a malicious page and the machine. In Docker it needs the seccomp
   * profile in packages/eval/docker/.
   */
  sandbox?: boolean;
}

/** Collects link and button candidates as {href, text} from the live page. */
const COLLECT_LINKS = `[...document.querySelectorAll("a[href]")].slice(0, 2000).map((a) => ({
  href: a.href,
  text: [a.textContent, a.getAttribute("aria-label"), a.getAttribute("title")].join(" ").slice(0, 200),
}))`;

const LOGIN_TEXT =
  /\b(log\s?in|sign\s?in|signin|login|my\s?account|account|anmelden|connexion|se connecter|iniciar\s?sesi[oó]n|entrar|accedi|inloggen|zaloguj|ログイン|登录|登入|로그인|войти)\b/i;
const NOT_LOGIN =
  /\b(sign\s?up|register|create\s?(an\s?)?account|join|log\s?out|sign\s?out|logout|forgot)\b/i;

/** Same-site links that look like login entry points, best first (at most 3). */
export function rankLoginLinks(links: { href: string; text: string }[], pageUrl: string): string[] {
  const site = registrableDomain(new URL(pageUrl).hostname);
  const scored = new Map<string, number>();
  for (const { href, text } of links) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (!site || registrableDomain(url.hostname) !== site) continue;
    const pathText = `${url.pathname} ${url.search}`;
    if (NOT_LOGIN.test(text) || NOT_LOGIN.test(pathText)) continue;
    const score =
      (LOGIN_TEXT.test(text) ? 2 : 0) +
      (/(log-?in|sign-?in|signin|auth|account)/i.test(pathText) ? 1 : 0);
    if (score === 0) continue;
    url.hash = "";
    scored.set(url.href, Math.max(scored.get(url.href) ?? 0, score));
  }
  return [...scored]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([u]) => u);
}

export function crawlId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export async function createCrawler(options: CrawlerOptions) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const settleMs = options.settleMs ?? 2_000;
  const allowHost = createHostGuard(options.resolveHost);
  const script = await extractorScript();
  // Every connection Chromium makes goes through the filtering proxy, loopback included
  // (Chromium bypasses proxies for loopback unless told otherwise). WebRTC can't be
  // proxied, so its UDP is disabled.
  const proxy = await startEgressProxy({
    ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
    ...(options.dial ? { dial: options.dial } : {}),
  });
  const launch = () =>
    chromium.launch({
      headless: options.headless ?? true,
      chromiumSandbox: options.sandbox ?? true,
      proxy: { server: proxy.url, bypass: "<-loopback>" },
      args: [
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ...(options.launchArgs ?? []),
      ],
    });
  let browser: Browser = await launch();
  await mkdir(options.outDir, { recursive: true });

  async function crawl(target: CrawlTarget, attempt = 1): Promise<CrawlRecord> {
    const started = Date.now();
    const id = crawlId(target.url);
    const record: CrawlRecord = {
      schema: CRAWL_SCHEMA,
      ...target,
      id,
      crawled_at: started,
      ok: false,
      status: null,
      final_url: null,
      chain: [],
      snapshot: null,
      gated: false,
      blocked_requests: 0,
      attempt,
      duration_ms: 0,
    };

    const dir = path.join(options.outDir, id);
    let context: BrowserContext | undefined;
    try {
      // A crashed browser is replaced, so one bad page can't stop a whole watcher cycle.
      if (!browser.isConnected()) browser = await launch();
      context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1280, height: 800 },
        acceptDownloads: false,
        permissions: [],
        serviceWorkers: "block",
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
      });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
        const verdict =
          url.protocol === "http:" || url.protocol === "https:"
            ? await allowHost(url.hostname)
            : "private";
        if (verdict !== "allow") {
          record.blocked_requests++;
          const req = route.request();
          if (req.isNavigationRequest() && req.frame().parentFrame() === null) {
            record.main_frame_refused = verdict;
          }
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      // context.route() never sees WebSockets, so they get the same guard here. Not calling
      // connectToServer() means a refused socket never reaches the network.
      await context.routeWebSocket(/.*/, async (ws) => {
        const url = new URL(ws.url());
        if (
          (url.protocol === "ws:" || url.protocol === "wss:") &&
          (await allowHost(url.hostname)) === "allow"
        ) {
          ws.connectToServer();
          return;
        }
        record.blocked_requests++;
        await ws.close({ code: 1008, reason: "blocked by crawler" }).catch(() => {});
      });
      context.on("page", (p) => {
        p.on("dialog", (d) => void d.dismiss().catch(() => {}));
      });

      const page = await context.newPage();
      // Popups opened by the page are closed; only the original tab is crawled.
      context.on("page", (p) => {
        if (p !== page) void p.close().catch(() => {});
      });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame() && record.chain.at(-1) !== frame.url()) {
          record.chain.push(frame.url());
        }
      });

      const response = await page.goto(target.url, { waitUntil: "load", timeout: timeoutMs });
      record.status = response?.status() ?? null;
      const serverHops: string[] = [];
      for (let req = response?.request().redirectedFrom(); req; req = req.redirectedFrom()) {
        serverHops.unshift(req.url());
      }
      record.chain = [...serverHops.filter((u) => !record.chain.includes(u)), ...record.chain];

      await page.waitForTimeout(settleMs);
      record.final_url = page.url();
      record.snapshot = (await page.evaluate(script)) as PageSnapshot;
      record.gated = hasSecretSurface(record.snapshot);
      if (target.discoverLogin) {
        record.login_links = rankLoginLinks(await page.evaluate(COLLECT_LINKS), record.final_url);
      }

      await mkdir(dir, { recursive: true });
      const html = await page.content();
      await writeFile(path.join(dir, "page.html"), html.slice(0, MAX_HTML));
      await page.screenshot({ path: path.join(dir, "screenshot.png"), timeout: 10_000 });
      record.ok = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.error =
        record.main_frame_refused === "unresolved"
          ? "dns: host did not resolve"
          : record.main_frame_refused === "private"
            ? "refused: host resolves to a private address"
            : (message.split("\n")[0] ?? message).slice(0, 300);
    } finally {
      await context?.close().catch(() => {});
    }

    record.duration_ms = Date.now() - started;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
    const { snapshot: _, ...summary } = record;
    await appendFile(path.join(options.outDir, "index.jsonl"), `${JSON.stringify(summary)}\n`);
    return record;
  }

  return {
    crawl,
    close: async () => {
      await browser.close().catch(() => {});
      await proxy.close();
    },
  };
}

export type Crawler = Awaited<ReturnType<typeof createCrawler>>;
