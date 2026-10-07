import { afterEach, describe, expect, it, vi } from "vitest";
import { type ClickRecord, createClickLog, isHijack, type StrictEvent } from "./hijack-detect.ts";

const SITE = "stream.example";
const T = 10_000;
const click = (
  linkHref: string | null,
  at = T - 100,
  input: ClickRecord["input"] = "pointer",
): ClickRecord => ({ at, input, linkHref });
const newTab = (url: string): StrictEvent => ({ kind: "new-tab", url, at: T });
const nav = (
  url: string,
  transitionType = "link",
  transitionQualifiers: string[] = [],
  initiator?: string,
): StrictEvent => ({
  kind: "navigation",
  url,
  at: T,
  transitionType,
  transitionQualifiers,
  ...(initiator ? { initiator } : {}),
});

describe("isHijack: new tabs", () => {
  it("allows same-site tabs, visible links to the destination, and auth popups", () => {
    expect(isHijack(SITE, newTab("https://cdn.stream.example/v"), [click(null)])).toBe(false);
    expect(
      isHijack(SITE, newTab("https://news.example/a"), [click("https://www.news.example/a")]),
    ).toBe(false);
    expect(isHijack(SITE, newTab("https://accounts.google.com/o/oauth2"), [click(null)])).toBe(
      false,
    );
  });

  it("closes a tab opened from a click that wasn't on a link to it", () => {
    // Invisible full-screen link: the content script reports linkHref null.
    expect(isHijack(SITE, newTab("https://ads.example/x"), [click(null)])).toBe(true);
    // href swapped after pointerdown: the recorded link goes elsewhere.
    expect(
      isHijack(SITE, newTab("https://ads.example/x"), [click("https://stream.example/next")]),
    ).toBe(true);
  });

  it("allows when there is no click record at all", () => {
    expect(isHijack(SITE, newTab("https://ads.example/x"), [])).toBe(false);
    // A click older than the window doesn't count.
    expect(isHijack(SITE, newTab("https://ads.example/x"), [click(null, T - 5_000)])).toBe(false);
  });

  it("ignores non-web destinations", () => {
    expect(isHijack(SITE, newTab("about:blank"), [click(null)])).toBe(false);
  });
});

describe("isHijack: same-tab navigations", () => {
  it("allows browser-started navigations", () => {
    for (const type of ["typed", "auto_bookmark", "generated", "keyword", "reload"]) {
      expect(isHijack(SITE, nav("https://ads.example/", type), [])).toBe(false);
    }
    expect(isHijack(SITE, nav("https://ads.example/", "link", ["forward_back"]), [])).toBe(false);
    expect(isHijack(SITE, nav("https://ads.example/", "link", ["from_address_bar"]), [])).toBe(
      false,
    );
  });

  it("allows a click or keyboard activation on a visible link to the destination", () => {
    expect(isHijack(SITE, nav("https://news.example/"), [click("https://news.example/")])).toBe(
      false,
    );
    expect(
      isHijack(SITE, nav("https://news.example/"), [click("https://news.example/", T - 50, "key")]),
    ).toBe(false);
  });

  it("goes back on a redirect started by a third-party iframe", () => {
    expect(
      isHijack(SITE, nav("https://ads.example/", "link", [], "https://player.adhost.example"), [
        click(null),
      ]),
    ).toBe(true);
  });

  it("goes back on a script redirect with no matching click", () => {
    expect(isHijack(SITE, nav("https://ads.example/", "link", ["client_redirect"]), [])).toBe(true);
  });

  it("allows a cross-site form submission after user input, not without", () => {
    expect(
      isHijack(SITE, nav("https://search.example/q", "form_submit"), [click(null, T - 50, "key")]),
    ).toBe(false);
    expect(isHijack(SITE, nav("https://search.example/q", "form_submit"), [])).toBe(true);
  });

  it("goes back when the user clicked something that wasn't a link to the destination", () => {
    expect(isHijack(SITE, nav("https://ads.example/"), [click(null)])).toBe(true);
  });

  it("allows a link navigation with no click record (lost to a worker restart)", () => {
    expect(isHijack(SITE, nav("https://ads.example/"), [])).toBe(false);
  });
});

describe("click log", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps recent clicks per tab and drops old ones", () => {
    let t = 1_000;
    const log = createClickLog(() => t);
    log.add(1, click(null, 1_000));
    t = 7_000;
    log.add(1, click(null, 7_000));
    expect(log.recent(1).map((c) => c.at)).toEqual([7_000]);
    expect(log.recent(2)).toEqual([]);
    log.forget(1);
    expect(log.recent(1)).toEqual([]);
  });

  it("waits for a click to arrive, up to a timeout", async () => {
    vi.useFakeTimers();
    const log = createClickLog(() => Date.now());
    const since = Date.now();
    let done = false;
    const waiting = log.waitFor(1, since, 250).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    log.add(1, click(null, since + 100));
    await waiting;
    expect(done).toBe(true);

    let timedOut = false;
    const empty = log.waitFor(2, since, 250).then(() => {
      timedOut = true;
    });
    await vi.advanceTimersByTimeAsync(250);
    await empty;
    expect(timedOut).toBe(true);
  });
});
