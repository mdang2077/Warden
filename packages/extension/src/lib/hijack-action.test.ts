import { describe, expect, it, vi } from "vitest";
import {
  BADGE_COLOR,
  createHijackAction,
  getHijackRecord,
  LOOP_LIMIT,
  MAX_BLOCKS,
} from "./hijack-action.ts";
import { memoryArea } from "./test-utils.ts";

function setup(area = memoryArea()) {
  let t = 1_000;
  const tabs = {
    remove: vi.fn(async (_id: number) => {}),
    goBack: vi.fn(async (_id: number) => {}),
  };
  const badge = {
    setBadgeText: vi.fn(async (_d: { tabId: number; text: string }) => {}),
    setBadgeBackgroundColor: vi.fn(async (_d: { tabId: number; color: string }) => {}),
  };
  const notify = vi.fn(async (_tabId: number, _block: unknown) => {});
  const action = createHijackAction({ area, tabs, badge, notify, now: () => t });
  return {
    area,
    tabs,
    badge,
    notify,
    action,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const POP = "https://go.popads.net/x";

describe("hijack action", () => {
  it("closes a new tab a page opened and counts it on the source tab", async () => {
    const { area, tabs, badge, action } = setup();
    await action.onCommitted(1, "https://stream.example/watch");
    await action.recordOpener(2, 1);
    expect(await action.handle({ tabId: 2, url: POP, layer: "standard" })).toBe("closed");
    expect(tabs.remove).toHaveBeenCalledWith(2);
    expect(tabs.goBack).not.toHaveBeenCalled();
    const record = await getHijackRecord(area, 1);
    expect(record).toEqual({
      siteKey: "stream.example",
      blocks: [{ destinationHost: "go.popads.net", kind: "new-tab", layer: "standard", at: 1_000 }],
    });
    expect(badge.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: "1" });
    expect(badge.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 1, color: BADGE_COLOR });
  });

  it("sends a redirected tab back", async () => {
    const { area, tabs, action } = setup();
    await action.onCommitted(1, "https://stream.example/watch");
    expect(await action.handle({ tabId: 1, url: POP, layer: "standard" })).toBe("went-back");
    expect(tabs.goBack).toHaveBeenCalledWith(1);
    expect((await getHijackRecord(area, 1))?.blocks[0]?.kind).toBe("redirect");
  });

  it("stops going back after LOOP_LIMIT times in 10 s, and resumes later", async () => {
    const { tabs, action, advance } = setup();
    for (let i = 0; i < LOOP_LIMIT; i++) {
      expect(await action.handle({ tabId: 1, url: POP, layer: "standard" })).toBe("went-back");
      advance(1_000);
    }
    expect(await action.handle({ tabId: 1, url: POP, layer: "standard" })).toBe("left");
    expect(tabs.goBack).toHaveBeenCalledTimes(LOOP_LIMIT);
    advance(10_000);
    expect(await action.handle({ tabId: 1, url: POP, layer: "standard" })).toBe("went-back");
  });

  it("leaves the blocked page when there is no history", async () => {
    const { tabs, action } = setup();
    tabs.goBack.mockRejectedValueOnce(new Error("Cannot find a next page in history."));
    expect(await action.handle({ tabId: 1, url: POP, layer: "standard" })).toBe("left");
  });

  it("tolerates a tab that is already gone", async () => {
    const { area, tabs, badge, action } = setup();
    await action.recordOpener(2, 1);
    tabs.remove.mockRejectedValueOnce(new Error("No tab with id: 2."));
    badge.setBadgeText.mockRejectedValueOnce(new Error("No tab with id: 1."));
    expect(await action.handle({ tabId: 2, url: POP, layer: "standard" })).toBe("closed");
    expect((await getHijackRecord(area, 1))?.blocks).toHaveLength(1);
  });

  it("keeps the opener across an about:blank commit", async () => {
    const { tabs, action } = setup();
    await action.recordOpener(2, 1);
    await action.onCommitted(2, "about:blank");
    expect(await action.handle({ tabId: 2, url: POP, layer: "standard" })).toBe("closed");
    expect(tabs.remove).toHaveBeenCalledWith(2);
  });

  it("treats a tab as no longer new once it commits a web page", async () => {
    const { tabs, action } = setup();
    await action.recordOpener(2, 1);
    await action.onCommitted(2, "https://news.example/");
    expect(await action.handle({ tabId: 2, url: POP, layer: "standard" })).toBe("went-back");
    expect(tabs.remove).not.toHaveBeenCalled();
  });

  it("closes a tab strict mode judged new, even after its first commit cleared the opener", async () => {
    const { area, tabs, action } = setup();
    await action.recordOpener(2, 1);
    await action.onCommitted(2, "https://ads.example/"); // commits while strict mode decides
    const outcome = await action.handle({
      tabId: 2,
      url: "https://ads.example/",
      layer: "strict",
      openedBy: 1,
    });
    expect(outcome).toBe("closed");
    expect(tabs.remove).toHaveBeenCalledWith(2);
    expect(tabs.goBack).not.toHaveBeenCalled();
    expect((await getHijackRecord(area, 1))?.blocks[0]?.kind).toBe("new-tab");
  });

  it("survives a worker restart between the new tab and the block", async () => {
    const area = memoryArea();
    await setup(area).action.recordOpener(2, 1);
    const restarted = setup(area);
    expect(await restarted.action.handle({ tabId: 2, url: POP, layer: "standard" })).toBe("closed");
  });

  it("resets the count on a different site, not on the same site", async () => {
    const { area, badge, action } = setup();
    await action.onCommitted(1, "https://stream.example/a");
    await action.handle({ tabId: 1, url: POP, layer: "standard" });
    await action.onCommitted(1, "https://www.stream.example/a"); // Warden's go-back lands here
    expect((await getHijackRecord(area, 1))?.blocks).toHaveLength(1);
    expect(badge.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: "1" });
    await action.onCommitted(1, "https://other.example/");
    expect(await getHijackRecord(area, 1)).toEqual({ siteKey: "other.example", blocks: [] });
    expect(badge.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: "" });
  });

  it("caps the stored blocks", async () => {
    const { area, action, advance } = setup();
    for (let i = 0; i < MAX_BLOCKS + 5; i++) {
      await action.recordOpener(100 + i, 1);
      await action.handle({ tabId: 100 + i, url: POP, layer: "strict" });
      advance(1);
    }
    expect((await getHijackRecord(area, 1))?.blocks).toHaveLength(MAX_BLOCKS);
  });

  it("forgets a closed tab", async () => {
    const { area, action } = setup();
    await action.onCommitted(1, "https://stream.example/");
    await action.recordOpener(1, 9);
    await action.forgetTab(1);
    expect(await getHijackRecord(area, 1)).toBeNull();
    expect(await action.openerOf(1)).toBeNull();
  });
});

describe("hijack action notices", () => {
  it("reports a closed pop-up to the tab that opened it", async () => {
    const { action, notify } = setup();
    await action.recordOpener(2, 1);
    await action.handle({ tabId: 2, url: POP, layer: "standard" });
    expect(notify).toHaveBeenCalledWith(1, expect.objectContaining({ kind: "new-tab" }));
  });

  it("reports an undone redirect to the redirected tab", async () => {
    const { action, notify } = setup();
    await action.handle({ tabId: 3, url: POP, layer: "strict" });
    expect(notify).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ kind: "redirect", destinationHost: "go.popads.net" }),
    );
  });

  it("stays quiet when it leaves the blocked page up instead of going back", async () => {
    const { action, notify, tabs } = setup();
    tabs.goBack.mockRejectedValue(new Error("no history"));
    expect(await action.handle({ tabId: 4, url: POP, layer: "standard" })).toBe("left");
    expect(notify).not.toHaveBeenCalled();
  });
});
