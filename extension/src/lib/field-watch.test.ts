// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchFields } from "./field-watch.ts";

/** Lets MutationObserver callbacks (microtasks) run, then fires due timers. */
async function tick(ms: number) {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
}

describe("watchFields", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  it("checks right away and stops for good once the check reports done", async () => {
    const check = vi.fn(() => true);
    watchFields(document, check);
    expect(check).toHaveBeenCalledTimes(1);
    document.body.append(document.createElement("input"));
    await tick(1000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("re-checks when a hidden form is revealed by a style or class change", async () => {
    document.body.innerHTML = '<form id="f" style="display:none"><input type="password"></form>';
    const check = vi.fn(() => false);
    watchFields(document, check, { throttleMs: 100 });
    (document.getElementById("f") as HTMLElement).style.display = "block";
    await tick(150);
    expect(check).toHaveBeenCalledTimes(2);
    (document.getElementById("f") as HTMLElement).className = "shown";
    await tick(150);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("throttles bursts but never starves: continuous mutations still get checked", async () => {
    document.body.innerHTML = '<div id="a"></div>';
    const check = vi.fn(() => false);
    watchFields(document, check, { throttleMs: 100 });
    const a = document.getElementById("a") as HTMLElement;
    for (let i = 0; i < 20; i++) {
      a.style.opacity = String(i / 20); // an animation touching style every 20 ms
      await tick(20);
    }
    // 400 ms of constant mutations: a check every ~100 ms, not one at the very end.
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(check.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("stops watching mutations after the window but still re-checks when a field gets focus", async () => {
    document.body.innerHTML = '<input id="u" type="password" style="display:none"><p id="p">x</p>';
    const check = vi.fn(() => false);
    watchFields(document, check, { watchMs: 1000, throttleMs: 100 });
    await tick(1100);
    document.body.append(document.createElement("div"));
    await tick(150);
    expect(check).toHaveBeenCalledTimes(1);

    const u = document.getElementById("u") as HTMLInputElement;
    u.style.display = "block";
    u.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await tick(150);
    expect(check).toHaveBeenCalledTimes(2);

    document.getElementById("p")?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await tick(150);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("returns a stop function that ends all watching", async () => {
    document.body.innerHTML = '<input id="u">';
    const check = vi.fn(() => false);
    const stop = watchFields(document, check, { throttleMs: 100 });
    stop();
    document.body.append(document.createElement("div"));
    document.getElementById("u")?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await tick(500);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
