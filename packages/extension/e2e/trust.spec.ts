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
