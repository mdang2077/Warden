// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_TAG, showNotice } from "./notice-card.ts";

const card = () => document.querySelector(NOTICE_TAG);
const text = () => card()?.shadowRoot?.querySelector("[role=status]")?.textContent ?? null;

describe("showNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    card()?.remove();
  });
  afterEach(() => vi.useRealTimers());

  it("shows the message in an announced card", () => {
    showNotice(document, "Warden closed a pop-up to casino.example");
    expect(text()).toBe("Warden closed a pop-up to casino.example");
  });

  it("updates the visible card instead of stacking a second one", () => {
    showNotice(document, "Warden closed a pop-up to casino.example");
    showNotice(document, "Warden closed 2 pop-ups");
    expect(document.querySelectorAll(NOTICE_TAG)).toHaveLength(1);
    expect(text()).toBe("Warden closed 2 pop-ups");
  });

  it("goes away after the display time, restarted by an update", () => {
    showNotice(document, "one", { durationMs: 3000 });
    vi.advanceTimersByTime(2000);
    showNotice(document, "two", { durationMs: 3000 });
    vi.advanceTimersByTime(2500);
    expect(card()).not.toBeNull();
    vi.advanceTimersByTime(1000); // 3 s after the update, plus the fade
    expect(card()).toBeNull();
  });

  it("is dismissed by a click", () => {
    showNotice(document, "one");
    const status = card()?.shadowRoot?.querySelector<HTMLElement>("[role=status]");
    if (!status) throw new Error("no notice shown");
    status.click();
    vi.advanceTimersByTime(500);
    expect(card()).toBeNull();
  });

  it("renders the message as text, never as markup", () => {
    showNotice(document, '<img src="x" onerror="alert(1)">');
    expect(card()?.shadowRoot?.querySelector("img")).toBeNull();
    expect(text()).toBe('<img src="x" onerror="alert(1)">');
  });
});
