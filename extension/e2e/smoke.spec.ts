import type { Page } from "@playwright/test";
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
