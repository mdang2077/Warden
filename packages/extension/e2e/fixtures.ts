import type { Server } from "node:http";
import path from "node:path";
import { type BrowserContext, test as base, chromium } from "@playwright/test";
import { setManifestTampered, setSbFailing, startFeedServer } from "./feed-server.ts";

const EXTENSION_PATH = path.resolve(import.meta.dirname, "../.output/chrome-mv3-e2e");

/** Test pages by path, served on any test host. */
export const TEST_PAGES: Record<string, string> = {
  "/exfil-login":
    "<!doctype html><title>Webmail</title>" +
    '<form id="f"><input name="email" type="email"><input type="password" name="pw">' +
    "<button>Sign in</button></form>" +
    '<script>const BOT = "https://api.telegram.org/bot123:TOKEN/sendMessage";</script>',
  // A webmail kit's pattern: the form is in the page from the start but hidden behind a
  // "loading" overlay, then revealed by a style change alone (no nodes added or removed).
  "/late-login":
    '<!doctype html><title>Mail</title><div id="loading">Loading mail settings...</div>' +
    '<form id="f" style="display:none"><input name="email" type="email">' +
    '<input type="password" name="pw"><button>Sign in</button></form>' +
    "<script>setTimeout(() => {" +
    ' document.getElementById("loading").style.display = "none";' +
    ' document.getElementById("f").style.display = "block"; }, 1500);</script>',
  // A page whose button opens an affiliate landing page in a new tab (not a pop network).
  "/opens-casino":
    '<!doctype html><title>Video</title><button id="play">Play</button>' +
    '<script>document.getElementById("play").onclick = () =>' +
    ' window.open("https://casino.other-test.example/?click_id=1", "_blank");</script>',
  // A visible link to an ad tracker page that script-redirects to a third site (H8).
  // (Playwright doesn't route a server redirect's target, so the hop is client-side.)
  "/tracker-link":
    '<!doctype html><title>Video</title><a id="go" target="_blank"' +
    ' href="https://track.other-test.example/hop">Watch now</a>',
  // Hops immediately: strict mode must not mistake this for a second, unclicked pop-up.
  "/hop":
    "<!doctype html><title>Loading</title>" +
    '<script>location.replace("https://casino.third-test.example/");</script>',
  // Starts a file download from another site on load, with no click (H9).
  "/forced-download":
    "<!doctype html><title>Video</title><p>Loading…</p>" +
    '<script>setTimeout(() => { location.href = "https://files.other-test.example/setup.exe"; }, 300);</script>',
  "/chase-login":
    "<!doctype html><title>Chase Online - Sign In</title><h1>Chase Online sign in</h1>" +
    '<form><input name="user"><input type="password" name="pw"><button>Sign in</button></form>',
  "/hijack-click":
    '<!doctype html><title>Video</title><button id="play">Play</button>' +
    '<script>document.addEventListener("click", () => window.open("https://go.popnet-test.example/pop", "_blank"));</script>',
  "/tab-under":
    '<!doctype html><title>Video</title><button id="play">Play</button>' +
    '<script>document.getElementById("play").onclick = () => {' +
    ' window.open(location.origin + "/content", "_blank");' +
    ' location.href = "https://go.popnet-test.example/under"; };</script>',
  "/strict-overlay":
    "<!doctype html><title>Video</title><p>Video</p>" +
    '<a id="overlay" href="https://ads.other-test.example/" target="_blank"' +
    ' style="position:fixed;inset:0;opacity:0"></a>',
  "/strict-auth":
    '<!doctype html><title>Video</title><button id="signin">Sign in</button>' +
    '<script>document.getElementById("signin").onclick = () =>' +
    ' window.open("https://accounts.google.com/o/oauth2/auth", "_blank", "popup");</script>',
  "/strict-outlink":
    "<!doctype html><title>Video</title>" +
    '<a id="download" href="https://redirect.warden-test.example/?to=https://cdn.other-test.example/file">Download</a>',
  "/strict-redirect":
    '<!doctype html><title>Video</title><button id="play">Play</button>' +
    '<script>document.getElementById("play").onclick = () => {' +
    ' location.href = "https://ads.other-test.example/landing"; };</script>',
};

export const test = base.extend<
  { context: BrowserContext; extensionId: string; tamperedManifest: boolean; sbFailing: boolean },
  { feedServer: Server }
>({
  /** Serve a forged manifest from the start (the extension syncs on install). */
  tamperedManifest: [false, { option: true }],
  /** The Safe Browsing proxy answers 503 (over budget). */
  sbFailing: [false, { option: true }],
  // The extension syncs on install, so the feed server must be up before Chrome starts.
  feedServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
    async ({}, use) => {
      const server = await startFeedServer();
      await use(server);
      await new Promise((resolve) => server.close(resolve));
    },
    { scope: "worker", auto: true },
  ],
  context: async ({ feedServer: _, tamperedManifest, sbFailing }, use) => {
    setManifestTampered(tamperedManifest);
    setSbFailing(sbFailing);
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    // Serve the fake test hosts locally; nothing goes to the network.
    await context.route(
      /^https:\/\/[^/]*\.(warden-test|popnet-test|other-test|third-test)\.example\//,
      (route) => {
        const url = new URL(route.request().url());
        // https://redirect.<any test site>/?to=<url> answers with a 302.
        const to = url.hostname.startsWith("redirect.") && url.searchParams.get("to");
        if (to) return route.fulfill({ status: 302, headers: { location: to } });
        // Any .exe path is served as a file download.
        if (url.pathname.endsWith(".exe")) {
          return route.fulfill({
            status: 200,
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition": "attachment; filename=setup.exe",
            },
            body: "MZ",
          });
        }
        const testPage = TEST_PAGES[url.pathname];
        if (testPage) return route.fulfill({ contentType: "text/html", body: testPage });
        if (url.pathname === "/login") {
          return route.fulfill({
            contentType: "text/html",
            body: '<!doctype html><title>Sign in</title><form><input name="user"><input type="password" name="pw"></form>',
          });
        }
        return route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>Test page</title><h1>Test page</h1>",
        });
      },
    );
    await context.route(/^https:\/\/accounts\.google\.com\//, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Sign in</title>" }),
    );
    await use(context);
    await context.close();
    setManifestTampered(false);
    setSbFailing(false);
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    // The worker can be reported before its script has finished evaluating on first install;
    // navigations in that window miss the listeners. Evaluating waits until it's ready.
    await worker.evaluate(() => true);
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
