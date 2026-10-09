/// <reference types="chrome" />
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

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

const readLog = (context: BrowserContext) =>
  worker(context).evaluate(
    async () => ((await chrome.storage.local.get("shadow_log")).shadow_log ?? []) as unknown[],
  );

async function openPopup(context: BrowserContext, extensionId: string, url: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(
    `chrome-extension://${extensionId}/popup.html?tab=${await tabIdFor(context, url)}`,
  );
  return popup;
}

test("trusting a site in the popup marks its login pages, and Remove untrusts it", async ({
  context,
  extensionId,
}) => {
  const login = "https://shop.warden-test.example/login";
  const page = await context.newPage();
  await page.goto(login);
  const popup = await openPopup(context, extensionId, login);
  await popup.getByLabel("Trust this site").check();
  await expect(popup.locator("#trusted-list li")).toContainText(["warden-test.example"]);

  // A fresh visit to a login page on that site is logged as trusted.
  await page.goto("https://other.warden-test.example/login");
  await expect
    .poll(async () =>
      (await readLog(context)).find((e) => JSON.stringify(e).includes("other.warden-test")),
    )
    .toMatchObject({ kind: "gate", trusted: true });

  await popup.reload();
  await popup.getByText("Trusted sites (1)").click(); // the list starts collapsed
  await popup.getByRole("button", { name: "Remove warden-test.example" }).click();
  await expect(popup.locator("#trusted-list li")).toHaveCount(0);
  await expect(popup.getByLabel("Trust this site")).not.toBeChecked();
  const stored = await worker(context).evaluate(
    async () => (await chrome.storage.local.get("trusted_sites")).trusted_sites,
  );
  expect(stored).toEqual({});
});

test("a trusted site on a phishing list is still blocked", async ({ context, extensionId }) => {
  await worker(context).evaluate(() =>
    chrome.storage.local.set({ trusted_sites: { "warden-test.example": 1 } }),
  );
  const page = await context.newPage();
  await page.goto("https://phish.warden-test.example/login").catch(() => {});
  await expect
    .poll(() => page.url())
    .toMatch(new RegExp(`^chrome-extension://${extensionId}/warning\\.html\\?`));
});

test("the popup summarizes the Stage 2 log and lists pages that would have warned", async ({
  context,
  extensionId,
}) => {
  // Telegram exfil (credential destination) + "paypal" in the address (URL/host): a warn candidate.
  const phishy = "https://paypal-verify.warden-test.example/exfil-login";
  const page = await context.newPage();
  await page.goto(phishy);
  await expect.poll(async () => (await readLog(context)).length).toBeGreaterThan(0);

  const popup = await openPopup(context, extensionId, phishy);
  const summary = popup.locator("#shadow-summary");
  await expect(summary).toHaveText("Stage 2 log: 1 login page · would have warned on 1");
  await summary.click(); // starts collapsed
  await expect(popup.locator("#shadow-warns li")).toHaveCount(1);
  await expect(popup.locator("#shadow-warns li")).toContainText(
    "sends to Telegram + brand name in address",
  );

  const download = popup.waitForEvent("download");
  await popup.getByRole("button", { name: "Export log" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^warden-shadow-log-\d{4}-\d{2}-\d{2}\.json$/);
  // Let the download finish so closing the browser doesn't wait on it.
  expect(await file.path()).toBeTruthy();
});

test.describe("when Safe Browsing is failing", () => {
  test.use({ sbFailing: true });

  test("the popup says protection is reduced, and pages still load", async ({
    context,
    extensionId,
  }) => {
    const url = "https://news.warden-test.example/story";
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.locator("h1")).toHaveText("Test page"); // fails open
    await expect
      .poll(() =>
        worker(context).evaluate(
          async () =>
            ((await chrome.storage.session.get("sb_health")).sb_health ?? null) as unknown,
        ),
      )
      .toMatchObject({ lastErrorAt: expect.any(Number) });
    const popup = await openPopup(context, extensionId, url);
    await expect(popup.locator("#sb-degraded")).toBeVisible();
  });
});

test("the popup doesn't show the note while Safe Browsing works", async ({
  context,
  extensionId,
}) => {
  const url = "https://news.warden-test.example/story";
  const page = await context.newPage();
  await page.goto(url);
  const popup = await openPopup(context, extensionId, url);
  await expect(popup.locator("#status")).not.toHaveText("Checking…");
  await expect(popup.locator("#sb-degraded")).toBeHidden();
});

test("a Safe Browsing block carries Google's attribution and reliability notice; others don't", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const warning = (s: string) =>
    `chrome-extension://${extensionId}/warning.html?u=${encodeURIComponent("https://bad.example/")}&s=${s}`;
  await page.goto(warning("safe_browsing"));
  await expect(page.locator("#sb-attribution")).toBeVisible();
  await expect(page.locator("#sb-attribution")).toContainText("Advisory provided by Google");
  await expect(page.locator("#sb-attribution")).toContainText("cannot guarantee");
  await page.goto(warning("openphish"));
  await expect(page.locator("#sb-attribution")).toBeHidden();
});

test("the About page credits Google Safe Browsing and EasyList, and the popup links to it", async ({
  context,
  extensionId,
}) => {
  const url = "https://news.warden-test.example/story";
  const page = await context.newPage();
  await page.goto(url);
  const popup = await openPopup(context, extensionId, url);
  const opened = context.waitForEvent("page");
  await popup.getByRole("link", { name: "About Warden" }).click();
  const about = await opened;
  await expect(about).toHaveURL(`chrome-extension://${extensionId}/about.html`);
  await expect(about.locator("main")).toContainText("Google Safe Browsing");
  await expect(about.locator("main")).toContainText("cannot guarantee");
  await expect(about.locator("main")).toContainText("EasyList");
  await expect(about.locator("main")).toContainText("CC BY-SA");
});

test("the warning page links to a pre-filled public report, without the page's query", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const blocked = "https://shop.example/login?token=SECRET";
  await page.goto(
    `chrome-extension://${extensionId}/warning.html?u=${encodeURIComponent(blocked)}&s=openphish`,
  );
  const href = await page.getByRole("link", { name: /Report a wrong block/ }).getAttribute("href");
  const url = new URL(href ?? "");
  expect(url.origin + url.pathname).toBe("https://github.com/mdang2077/Warden/issues/new");
  expect(url.searchParams.get("url")).toBe("https://shop.example/login");
  expect(href).not.toContain("SECRET");
});
