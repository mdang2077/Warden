/// <reference types="chrome" />
import type { BrowserContext } from "@playwright/test";
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

test("a page's popup to a pop network is closed and counted", async ({
  context,
  extensionId: _,
}) => {
  await hijackRulesReady(context);
  const page = await context.newPage();
  await page.goto(`${STREAM}/hijack-click`);
  const popup = context.waitForEvent("page");
  await page.click("#play");
  await (await popup).waitForEvent("close");
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
