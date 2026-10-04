/**
 * Hardened page crawler for Stage 2 corpora. Each URL gets a fresh browser context:
 * no downloads, no permissions, no service workers, dialogs dismissed, popups closed, and
 * no requests to private networks. The crawler never clicks or submits anything; it loads
 * the page, lets it settle, and runs the shared extractor.
 *
 * Output per URL under `outDir/<id>/`: record.json, page.html, screenshot.png, plus a line
 * in `outDir/index.jsonl`.
 *
 * Where to run it: crawled pages are live phishing sites running real JavaScript. Run real
 * phish crawls in a throwaway container or VM (or a CI runner), not on a machine with
 * anything to protect. The network guard resolves hosts separately from the browser, so a
 * DNS-rebinding page could still slip one request past it in the gap between lookups.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageSnapshot } from "@warden/shared/page/extract";
import { type Browser, chromium } from "playwright";
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
  /** Requests the network guard refused (private-network hosts). */
  blocked_requests: number;
  duration_ms: number;
}

export interface CrawlerOptions {
  outDir: string;
  /** Navigation timeout; the whole crawl gets this plus `settleMs` and a margin. */
  timeoutMs?: number;
  /** How long to let scripts run after load before extracting. */
  settleMs?: number;
  resolveHost?: Resolver;
  /** Extra Chromium flags (tests map fake hosts to a local server with these). */
  launchArgs?: string[];
  headless?: boolean;
}

export function crawlId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export async function createCrawler(options: CrawlerOptions) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const settleMs = options.settleMs ?? 2_000;
  const allowHost = createHostGuard(options.resolveHost);
  const script = await extractorScript();
  const browser: Browser = await chromium.launch({
    headless: options.headless ?? true,
    args: options.launchArgs ?? [],
  });
  await mkdir(options.outDir, { recursive: true });

  async function crawl(target: CrawlTarget): Promise<CrawlRecord> {
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
      blocked_requests: 0,
      duration_ms: 0,
    };

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
      permissions: [],
      serviceWorkers: "block",
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });
    const dir = path.join(options.outDir, id);
    try {
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
        if (
          (url.protocol !== "http:" && url.protocol !== "https:") ||
          !(await allowHost(url.hostname))
        ) {
          record.blocked_requests++;
          return route.abort("blockedbyclient");
        }
        return route.continue();
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

      await mkdir(dir, { recursive: true });
      const html = await page.content();
      await writeFile(path.join(dir, "page.html"), html.slice(0, MAX_HTML));
      await page.screenshot({ path: path.join(dir, "screenshot.png"), timeout: 10_000 });
      record.ok = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.error = (message.split("\n")[0] ?? message).slice(0, 300);
    } finally {
      await context.close().catch(() => {});
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
    close: () => browser.close(),
  };
}

export type Crawler = Awaited<ReturnType<typeof createCrawler>>;
