import type { Server } from "node:http";
import path from "node:path";
import { type BrowserContext, test as base, chromium } from "@playwright/test";
import { startFeedServer } from "./feed-server.ts";

const EXTENSION_PATH = path.resolve(import.meta.dirname, "../.output/chrome-mv3-e2e");

/** Test pages by path, served on any test host. */
export const TEST_PAGES: Record<string, string> = {
  "/hijack-click":
    '<!doctype html><title>Video</title><button id="play">Play</button>' +
    '<script>document.addEventListener("click", () => window.open("https://go.popnet-test.example/pop", "_blank"));</script>',
  "/tab-under":
    '<!doctype html><title>Video</title><button id="play">Play</button>' +
    '<script>document.getElementById("play").onclick = () => {' +
    ' window.open(location.origin + "/content", "_blank");' +
    ' location.href = "https://go.popnet-test.example/under"; };</script>',
};

export const test = base.extend<
  { context: BrowserContext; extensionId: string },
  { feedServer: Server }
>({
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
  context: async ({ feedServer: _ }, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    // Serve the fake test hosts locally; nothing goes to the network.
    await context.route(
      /^https:\/\/[^/]*\.(warden-test|popnet-test|other-test)\.example\//,
      (route) => {
        const url = new URL(route.request().url());
        // https://redirect.warden-test.example/?to=<url> answers with a 302.
        const to = url.hostname === "redirect.warden-test.example" && url.searchParams.get("to");
        if (to) return route.fulfill({ status: 302, headers: { location: to } });
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
    await use(context);
    await context.close();
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
