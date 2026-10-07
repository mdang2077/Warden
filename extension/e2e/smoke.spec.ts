/// <reference types="chrome" />
import type { Page } from "@playwright/test";
import { FEED_BLOCKED_HOST } from "./feed-server.ts";
import { expect, test } from "./fixtures.ts";

const BLOCKED = "https://phish.warden-test.example/login?next=%2Fhome";
const ALLOWED = "https://ok.warden-test.example/";

/** Polls instead of waitForURL: the redirect aborts the original navigation mid-flight. */
async function waitForInterstitial(page: Page, extensionId: string) {
  await expect
    .poll(() => page.url())
    .toMatch(new RegExp(`^chrome-extension://${extensionId}/warning\\.html\\?`));
  await page.waitForLoadState();
}

test("a blocked URL shows the interstitial", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(BLOCKED).catch(() => {
    // The redirect to the interstitial can abort the original navigation.
  });
  await waitForInterstitial(page, extensionId);

  await expect(page.getByRole("heading", { name: "Deceptive site ahead" })).toBeVisible();
  await expect(page.locator("#blocked-url")).toHaveText(BLOCKED);
  await expect(page.locator("#sources")).toHaveText("OpenPhish");
  await expect(page.getByRole("button", { name: "Back to safety" })).toBeFocused();
});

test("an ordinary URL loads normally", async ({ context, extensionId: _ }) => {
  const page = await context.newPage();
  await page.goto(ALLOWED);
  // Give the service worker time to act if it (wrongly) decided to block.
  await page.waitForTimeout(500);
  expect(page.url()).toBe(ALLOWED);
  await expect(page.getByRole("heading", { name: "Test page" })).toBeVisible();
});

test("Proceed anyway bypasses the block for that URL only", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(BLOCKED).catch(() => {});
  await waitForInterstitial(page, extensionId);

  await page.getByRole("button", { name: /Proceed anyway/ }).click();
  await page.waitForURL(BLOCKED);
  await page.waitForTimeout(500);
  expect(page.url()).toBe(BLOCKED);

  const other = await context.newPage();
  await other.goto("https://phish.warden-test.example/other").catch(() => {});
  await waitForInterstitial(other, extensionId);
});

test("a redirect into a blocked page names the link the user followed", async ({
  context,
  extensionId,
}) => {
  const link = `https://redirect.warden-test.example/?to=${encodeURIComponent(BLOCKED)}`;
  const page = await context.newPage();
  await page.goto(link).catch(() => {});
  await waitForInterstitial(page, extensionId);

  await expect(page.locator("#blocked-url")).toHaveText(BLOCKED);
  await expect(page.locator("#origin-url")).toHaveText(link);
});

test("feed sync installs Tier A rules and blocks a listed host", async ({
  context,
  extensionId,
}) => {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("no service worker");
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.condition.urlFilter),
      ),
    )
    .toContain(`||${FEED_BLOCKED_HOST}/`);

  const blocked = `https://login.${FEED_BLOCKED_HOST}/verify`;
  const page = await context.newPage();
  await page.goto(blocked).catch(() => {});
  await waitForInterstitial(page, extensionId);
  await expect(page.locator("#blocked-url")).toHaveText(blocked);
  await expect(page.locator("#sources")).toHaveText("OpenPhish");
});

test("Stage 2 shadow mode logs a login page locally, without the query", async ({
  context,
  extensionId: _,
}) => {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("no service worker");
  const page = await context.newPage();
  await page.goto("https://ok.warden-test.example/login?session=SECRET");
  await expect(page.getByRole("textbox").first()).toBeVisible();

  const readLog = () =>
    worker.evaluate(
      async () => ((await chrome.storage.local.get("shadow_log")).shadow_log ?? []) as unknown[],
    );
  await expect.poll(async () => (await readLog()).length).toBeGreaterThan(0);
  const [entry] = await readLog();
  expect(entry).toMatchObject({
    page: "https://ok.warden-test.example/login",
    kind: "gate",
    secrets: { password: 1 },
  });
  expect(JSON.stringify(entry)).not.toContain("SECRET");
  // Shadow mode: the page is not blocked or changed.
  expect(page.url()).toBe("https://ok.warden-test.example/login?session=SECRET");
});

test("Stage 2 shadow mode records a brand claimed on someone else's domain", async ({
  context,
  extensionId: _,
}) => {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("no service worker");
  const page = await context.newPage();
  await page.goto("https://ok.warden-test.example/chase-login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  const readLog = () =>
    worker.evaluate(
      async () => ((await chrome.storage.local.get("shadow_log")).shadow_log ?? []) as unknown[],
    );
  await expect
    .poll(async () => (await readLog()).find((e) => JSON.stringify(e).includes("chase-login")))
    .toMatchObject({
      kind: "gate",
      brandMismatch: { brand: "chase", cues: ["title", "heading"] },
    });
  // No page text in the log.
  expect(JSON.stringify(await readLog())).not.toContain("Chase Online");
});

test("Stage 2 shadow mode records credentials sent to a Telegram bot", async ({
  context,
  extensionId: _,
}) => {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("no service worker");
  const page = await context.newPage();
  await page.goto("https://ok.warden-test.example/exfil-login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  const readLog = () =>
    worker.evaluate(
      async () => ((await chrome.storage.local.get("shadow_log")).shadow_log ?? []) as unknown[],
    );
  await expect
    .poll(async () => (await readLog()).find((e) => JSON.stringify(e).includes("exfil-login")))
    .toMatchObject({ kind: "gate", exfil: { kind: "telegram", ip: false } });
  // Only the kind: never the bot URL or token.
  expect(JSON.stringify(await readLog())).not.toContain("TOKEN");
});
