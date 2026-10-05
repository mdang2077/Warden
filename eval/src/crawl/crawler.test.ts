import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Crawler, createCrawler, rankLoginLinks } from "./crawler.ts";
import { createHostGuard, isPrivateAddress } from "./network-guard.ts";

describe("network guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "2606:4700::1111"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("blocks hosts that resolve to any private address, or fail to resolve", async () => {
    const allow = createHostGuard(async (host) => {
      if (host === "public.example") return ["93.184.216.34"];
      if (host === "rebind.example") return ["93.184.216.34", "127.0.0.1"];
      throw new Error("NXDOMAIN");
    });
    expect(await allow("public.example")).toBe(true);
    expect(await allow("rebind.example")).toBe(false);
    expect(await allow("missing.example")).toBe(false);
    expect(await allow("localhost")).toBe(false);
    expect(await allow("[::1]")).toBe(false);
  });
});

const HOST = "crawl-test.example";
const PAGES: Record<string, { status?: number; headers?: Record<string, string>; body?: string }> =
  {
    [`login.${HOST}/`]: {
      body: `<title>Sign in</title><form action="/s" method="post">
      <input name="email"><input type="password" name="pw"></form>
      <img src="http://intranet.${HOST}/probe.png">
      <script>fetch("http://127.0.0.1:9/").catch(() => {});</script>`,
    },
    [`hop.${HOST}/`]: { status: 302, headers: { location: `http://hop2.${HOST}/` } },
    [`hop2.${HOST}/`]: { status: 302, headers: { location: `http://login.${HOST}/` } },
    [`client.${HOST}/`]: {
      body: `<script>location.replace("http://login.${HOST}/")</script>`,
    },
    [`noisy.${HOST}/`]: {
      body: `<title>Noisy</title><script>alert("x"); window.open("http://login.${HOST}/");</script>`,
    },
  };

describe("crawler", () => {
  let dir: string;
  let crawler: Crawler;
  let server: Server;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "warden-crawl-"));
    // A real server, so redirects are real; Chromium maps the fake hosts to it.
    server = createServer((req, res) => {
      const page = PAGES[`${(req.headers.host ?? "").split(":")[0]}${req.url}`];
      res.writeHead(page?.status ?? (page ? 200 : 404), {
        "content-type": "text/html",
        ...page?.headers,
      });
      res.end(page?.body ?? "");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    crawler = await createCrawler({
      outDir: dir,
      settleMs: 300,
      timeoutMs: 10_000,
      launchArgs: [`--host-resolver-rules=MAP *.${HOST} 127.0.0.1:${port}`],
      // The guard sees the test hosts as public, except the intranet one.
      resolveHost: async (host) => {
        if (host === `intranet.${HOST}`) return ["10.0.0.5"];
        if (host.endsWith(`.${HOST}`)) return ["93.184.216.34"];
        throw new Error("NXDOMAIN");
      },
    });
  }, 60_000);

  afterAll(async () => {
    await crawler?.close();
    await new Promise((resolve) => server?.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  it("crawls a login page, runs the extractor, and saves artifacts", async () => {
    const r = await crawler.crawl({ url: `http://login.${HOST}/`, label: "phish", group: "test" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.snapshot?.title).toBe("Sign in");
    expect(r.snapshot?.secrets.password).toBe(1);
    expect(r.gated).toBe(true);
    expect(r.snapshot?.forms[0]?.action).toBe(`http://login.${HOST}/s`);
    for (const f of ["record.json", "page.html", "screenshot.png"]) {
      expect(existsSync(path.join(dir, r.id, f)), f).toBe(true);
    }
    const index = readFileSync(path.join(dir, "index.jsonl"), "utf8");
    expect(index).toContain(r.id);
    expect(index).not.toContain('"snapshot"');
  }, 30_000);

  it("blocks requests to private networks from the crawled page", async () => {
    const r = await crawler.crawl({ url: `http://login.${HOST}/`, label: "phish", group: "test" });
    // intranet image (resolves to 10.0.0.5) and fetch to 127.0.0.1.
    expect(r.blocked_requests).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("records server and client redirect chains", async () => {
    const server = await crawler.crawl({
      url: `http://hop.${HOST}/`,
      label: "phish",
      group: "test",
    });
    expect(server.final_url).toBe(`http://login.${HOST}/`);
    expect(server.chain).toEqual([
      `http://hop.${HOST}/`,
      `http://hop2.${HOST}/`,
      `http://login.${HOST}/`,
    ]);

    const client = await crawler.crawl({
      url: `http://client.${HOST}/`,
      label: "phish",
      group: "test",
    });
    expect(client.final_url).toBe(`http://login.${HOST}/`);
    expect(client.chain).toEqual([`http://client.${HOST}/`, `http://login.${HOST}/`]);
    expect(client.snapshot?.secrets.password).toBe(1);
  }, 30_000);

  it("survives dialogs and popups", async () => {
    const r = await crawler.crawl({ url: `http://noisy.${HOST}/`, label: "phish", group: "test" });
    expect(r.ok).toBe(true);
    expect(r.snapshot?.title).toBe("Noisy");
  }, 30_000);

  it("records failures instead of throwing", async () => {
    const r = await crawler.crawl({ url: "https://gone.invalid/", label: "phish", group: "test" });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(existsSync(path.join(dir, r.id, "record.json"))).toBe(true);
  }, 30_000);
});

describe("rankLoginLinks", () => {
  it("keeps same-site login links, best first, and drops sign-up and other sites", () => {
    const links = [
      { href: "https://shop.example.com/account/login", text: "Sign in" },
      { href: "https://shop.example.com/help", text: "Help" },
      { href: "https://shop.example.com/register", text: "Create account" },
      { href: "https://www.example.com/auth?next=/", text: "" },
      { href: "https://other.example/login", text: "Log in" },
      { href: "https://shop.example.com/logout", text: "Log out" },
      { href: "javascript:void(0)", text: "Login" },
    ];
    expect(rankLoginLinks(links, "https://www.example.com/")).toEqual([
      "https://shop.example.com/account/login",
      "https://www.example.com/auth?next=/",
    ]);
  });
});
