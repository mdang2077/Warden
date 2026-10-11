/// <reference types="chrome" />
import type { BrowserContext, Page } from "@playwright/test";
import { POPNET_HOST } from "./feed-server.ts";
import { expect, test } from "./fixtures.ts";

const STREAM = "https://stream.warden-test.example";

function worker(context: BrowserContext) {
  const w = context.serviceWorkers()[0];
  if (!w) throw new Error("no service worker");
  return w;
}

async function tabIdFor(context: BrowserContext, url: string): Promise<number> {
  return worker(context).evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    if (tab?.id === undefined) throw new Error(`no tab for ${u}`);
    return tab.id;
  }, url);
}

async function badgeFor(context: BrowserContext, url: string): Promise<string> {
  const tabId = await tabIdFor(context, url);
  return worker(context).evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
}

/** Waits until the hijack rules are installed (sync done) with the given allowed sites. */
async function hijackRulesReady(context: BrowserContext, allowed: string[] = []) {
  await expect
    .poll(() =>
      worker(context).evaluate(async () =>
        (await chrome.declarativeNetRequest.getDynamicRules())
          .filter((r) => r.id >= 29_900)
          .map((r) => ({
            domains: r.condition.requestDomains,
            allowed: r.condition.excludedInitiatorDomains ?? [],
          })),
      ),
    )
    .toEqual([{ domains: ["popnet-test.example"], allowed }]);
}

async function setStrict(context: BrowserContext) {
  await worker(context).evaluate(() =>
    chrome.storage.local.set({
      popup_prefs: { phishing: true, hijack: true, sites: { "warden-test.example": "strict" } },
    }),
  );
}

test("a page's popup to a pop network is closed and counted", async ({
  context,
  extensionId: _,
}) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/hijack-click`);
  const popup = context.waitForEvent("page");
  await page.click("#play");
  const opened = await popup;
  await expect.poll(() => opened.isClosed()).toBe(true);
  await expect.poll(() => badgeFor(context, `${STREAM}/hijack-click`)).toBe("1");
});

test("a tab-under sends the original tab back and keeps the content tab", async ({
  context,
  extensionId: _,
}) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/tab-under`);
  const content = context.waitForEvent("page");
  await page.click("#play");
  await expect.poll(() => page.url()).toBe(`${STREAM}/tab-under`);
  expect((await content).url()).toBe(`${STREAM}/content`);
  await expect.poll(() => badgeFor(context, `${STREAM}/tab-under`)).toBe("1");
});

test("typing a pop network's address yourself loads it", async ({ context, extensionId: _ }) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  // DNR's thirdParty rule also blocks loads no page started; Warden heals and reloads them.
  await page.goto(`https://${POPNET_HOST}/typed`).catch(() => {});
  await expect(page).toHaveTitle("Test page");
  expect(page.url()).toBe(`https://${POPNET_HOST}/typed`);
});

test("Allow on a site lets its popups through", async ({ context, extensionId: _ }) => {
  await hijackRulesReady(context);
  await worker(context).evaluate(() =>
    chrome.storage.local.set({
      popup_prefs: { phishing: true, hijack: true, sites: { "warden-test.example": "allow" } },
    }),
  );
  await hijackRulesReady(context, ["warden-test.example"]);
  const page = await context.newPage();
  await page.goto(`${STREAM}/hijack-click`);
  const popup = context.waitForEvent("page");
  await page.click("#play");
  const opened = await popup;
  await expect(opened).toHaveTitle("Test page");
  expect(opened.isClosed()).toBe(false);
});

test("strict: a click on an invisible full-screen link doesn't open a tab", async ({
  context,
  extensionId: _,
}) => {
  await setStrict(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/strict-overlay`);
  const popup = context.waitForEvent("page");
  await page.mouse.click(200, 200);
  // Polled: the tab can close before a "close" listener would attach.
  const opened = await popup;
  await expect.poll(() => opened.isClosed()).toBe(true);
  await expect.poll(() => badgeFor(context, `${STREAM}/strict-overlay`)).toBe("1");
});

test("strict: a sign-in popup from a button stays open", async ({ context, extensionId: _ }) => {
  await setStrict(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/strict-auth`);
  const popup = context.waitForEvent("page");
  await page.click("#signin");
  const opened = await popup;
  await expect(opened).toHaveTitle("Sign in");
  await page.waitForTimeout(500); // past CLICK_WAIT_MS: Warden had its chance to close it
  expect(opened.isClosed()).toBe(false);
});

test("strict: a script redirect after a non-link click goes back", async ({
  context,
  extensionId: _,
}) => {
  await setStrict(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/strict-redirect`);
  await page.click("#play");
  await expect.poll(() => page.url()).toBe(`${STREAM}/strict-redirect`);
});

test("the toolbar popup lists blocks and its toggle takes effect without a reload", async ({
  context,
  extensionId,
}) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/hijack-click`);
  const first = context.waitForEvent("page");
  await page.click("#play");
  const firstPopup = await first;
  await expect.poll(() => firstPopup.isClosed()).toBe(true);
  await expect.poll(() => badgeFor(context, `${STREAM}/hijack-click`)).toBe("1");

  const tabId = await tabIdFor(context, `${STREAM}/hijack-click`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await expect(popup.locator("#site-name")).toHaveText("warden-test.example");
  await expect(popup.locator("#blocked-summary")).toHaveText("Blocked 1 on this page");
  await expect(popup.locator("#blocked-list li")).toContainText(["go.popnet-test.example"]);

  await popup.getByLabel("Block popups & redirects").uncheck();
  await expect
    .poll(() =>
      worker(context).evaluate(
        async () =>
          (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id >= 29_900)
            .length,
      ),
    )
    .toBe(0);

  await page.bringToFront();
  const second = context.waitForEvent("page");
  await page.click("#play");
  const opened = await second;
  await expect(opened).toHaveTitle("Test page");
  expect(opened.isClosed()).toBe(false);
});

test("strict: a visible link that server-redirects to another site still works", async ({
  context,
  extensionId: _,
}) => {
  await setStrict(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/strict-outlink`);
  await page.click("#download");
  await expect(page).toHaveURL("https://cdn.other-test.example/file");
  await page.waitForTimeout(500); // Warden had its chance to send the tab back
  expect(page.url()).toBe("https://cdn.other-test.example/file");
});

test("blocking a site in the popup stops other sites from opening it, until removed", async ({
  context,
  extensionId,
}) => {
  await hijackRulesReady(context);
  const casino = "https://casino.other-test.example/";
  const landing = await context.newPage();
  await landing.goto(casino); // typed: a site you open yourself always loads
  const popup = await context.newPage();
  await popup.goto(
    `chrome-extension://${extensionId}/popup.html?tab=${await tabIdFor(context, casino)}`,
  );
  await popup.getByLabel("Block when other sites open this").check();
  await expect(popup.locator("#blocked-sites-list li")).toContainText(["other-test.example"]);
  const blockedRule = () =>
    worker(context).evaluate(async () =>
      (await chrome.declarativeNetRequest.getDynamicRules()).some((r) =>
        r.condition.requestDomains?.includes("other-test.example"),
      ),
    );
  await expect.poll(blockedRule).toBe(true);

  // Another site opening it: the new tab is closed and counted.
  const page = await context.newPage();
  await page.goto(`${STREAM}/opens-casino`);
  const opened = context.waitForEvent("page");
  await page.click("#play");
  const tab = await opened;
  await expect.poll(() => tab.isClosed()).toBe(true);
  await expect.poll(() => badgeFor(context, `${STREAM}/opens-casino`)).toBe("1");

  // Removing it from the list lets it open again.
  await popup.reload();
  await popup.getByText("Blocked sites (1)").click();
  await popup.getByRole("button", { name: "Remove other-test.example" }).click();
  await expect(popup.locator("#blocked-sites-list li")).toHaveCount(0);
  await expect.poll(blockedRule).toBe(false);
});

test("a closed pop-up shows a short notice on the page that opened it", async ({
  context,
  extensionId: _,
}) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/hijack-click`);
  const popup = context.waitForEvent("page");
  await page.click("#play");
  await expect.poll(async () => (await popup).isClosed()).toBe(true);
  const notice = page.locator("warden-notice");
  await expect(notice).toContainText("Warden closed a pop-up to popnet-test.example");
  await expect(notice).toHaveCount(0, { timeout: 6_000 }); // gone after about 3 s
});

test("an undone redirect shows a notice on the page it went back to", async ({
  context,
  extensionId: _,
}) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/tab-under`);
  const content = context.waitForEvent("page");
  await page.click("#play");
  await content;
  await expect.poll(() => page.url()).toBe(`${STREAM}/tab-under`);
  await expect(page.locator("warden-notice")).toContainText(
    "Warden blocked a redirect to popnet-test.example and brought you back",
  );
});

test("no notice when notices are turned off", async ({ context, extensionId: _ }) => {
  await hijackRulesReady(context);
  await worker(context).evaluate(() =>
    chrome.storage.local.set({
      popup_prefs: { phishing: true, hijack: true, notices: false, sites: {} },
    }),
  );
  const page = await context.newPage();
  await page.goto(`${STREAM}/hijack-click`);
  const popup = context.waitForEvent("page");
  await page.click("#play");
  await expect.poll(async () => (await popup).isClosed()).toBe(true);
  await page.waitForTimeout(1_500);
  await expect(page.locator("warden-notice")).toHaveCount(0);
});

test("typing a blocked site yourself doesn't let other sites redirect to it afterwards", async ({
  context,
  extensionId: _,
}) => {
  await worker(context).evaluate(() =>
    chrome.storage.local.set({
      popup_prefs: { phishing: true, hijack: true, sites: {}, blocked: ["other-test.example"] },
    }),
  );
  await expect
    .poll(() =>
      worker(context).evaluate(async () =>
        (await chrome.declarativeNetRequest.getDynamicRules()).some((r) =>
          r.condition.requestDomains?.includes("other-test.example"),
        ),
      ),
    )
    .toBe(true);
  const casino = "https://casino.other-test.example/";

  // Typed: loads (after a brief block and a retry).
  const typed = await context.newPage();
  await typed.goto(casino).catch(() => {});
  await expect.poll(() => typed.url()).toBe(casino);
  await expect(typed.locator("h1")).toHaveText("Test page");

  // Another site redirecting to it afterwards is still blocked and sent back.
  const page = await context.newPage();
  await page.goto(`${STREAM}/plain`);
  await page.evaluate((url) => {
    location.href = url;
  }, casino);
  await page.waitForTimeout(2_000);
  expect(page.url()).toBe(`${STREAM}/plain`);
});

const experiments = (context: BrowserContext) =>
  worker(context).evaluate(
    async () =>
      ((await chrome.storage.local.get("hijack_experiments")).hijack_experiments ?? []) as {
        experiment: string;
      }[],
  );

test("experiment H8: a clicked link that redirects to a third site is logged, not blocked", async ({
  context,
  extensionId: _,
}) => {
  await hijackRulesReady(context);
  await setStrict(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/tracker-link`);
  const opened = context.waitForEvent("page");
  await page.click("#go");
  const tab = await opened;
  await expect.poll(() => tab.url()).toBe("https://casino.third-test.example/");
  expect(tab.isClosed()).toBe(false); // log only
  await expect
    .poll(async () => (await experiments(context)).at(-1))
    .toMatchObject({
      experiment: "click-redirect",
      site: "warden-test.example",
      linkSite: "other-test.example",
      landedSite: "third-test.example",
      via: "script",
    });
});

const prompt = (page: Page) => page.locator("warden-download-prompt .card");

/** Chrome's download records whose URL ends with `name` (Playwright saves under random names). */
const downloadsFrom = (context: BrowserContext, name: string) =>
  worker(context).evaluate(
    async (n) =>
      (await chrome.downloads.search({}))
        .filter((d) => d.url.endsWith(n) || d.finalUrl.endsWith(n))
        .map((d) => ({ state: d.state, exists: d.exists })),
    name,
  );

test("H9: a forced installer download from another site is paused and the user asked; Cancel removes it", async ({
  context,
  extensionId: _,
}) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  const download = page.waitForEvent("download");
  await page.goto(`${STREAM}/forced-download`);
  expect((await download).suggestedFilename()).toBe("setup.exe");
  await expect(prompt(page)).toContainText(
    "Warden paused a download of a .exe file from other-test.example",
  );
  await expect
    .poll(async () => (await experiments(context)).at(-1))
    .toMatchObject({
      experiment: "download",
      site: "warden-test.example",
      downloadSite: "other-test.example",
      fileType: "exe",
      reason: "installer",
    });
  await expect.poll(async () => (await downloadsFrom(context, "/setup.exe")).length).toBe(1);
  await prompt(page).getByRole("button", { name: "Cancel download" }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect.poll(() => downloadsFrom(context, "/setup.exe")).toEqual([]);
});

test("H9: Keep lets the paused download through", async ({ context, extensionId: _ }) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  const download = page.waitForEvent("download");
  await page.goto(`${STREAM}/forced-download`);
  await download;
  await prompt(page).getByRole("button", { name: "Keep" }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect
    .poll(() => downloadsFrom(context, "/setup.exe"))
    .toEqual([{ state: "complete", exists: true }]);
});

test("H9: a file the user clicked a visible link to downloads without asking", async ({
  context,
  extensionId: _,
}) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/download-link`);
  const download = page.waitForEvent("download");
  await page.click("#get");
  expect((await download).suggestedFilename()).toBe("setup.exe");
  await expect
    .poll(() => downloadsFrom(context, "/app.exe"))
    .toEqual([{ state: "complete", exists: true }]);
  await page.waitForTimeout(500);
  await expect(prompt(page)).toHaveCount(0);
});
