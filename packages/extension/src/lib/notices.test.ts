import { describe, expect, it, vi } from "vitest";
import type { HijackBlock } from "./hijack-action.ts";
import { createNotices, NOTICE_GROUP_MS, NOTICE_TTL_MS, noticeText } from "./notices.ts";

const block = (over: Partial<HijackBlock> = {}): HijackBlock => ({
  destinationHost: "www.casino.example",
  kind: "new-tab",
  layer: "standard",
  at: 0,
  ...over,
});

describe("noticeText", () => {
  it("names the site for a single block", () => {
    expect(noticeText([block()])).toBe("Warden closed a pop-up to casino.example");
    expect(noticeText([block({ kind: "redirect" })])).toBe(
      "Warden blocked a redirect to casino.example and brought you back",
    );
  });

  it("counts several blocks", () => {
    expect(noticeText([block(), block()])).toBe("Warden closed 2 pop-ups");
    const r = block({ kind: "redirect" });
    expect(noticeText([r, r, r])).toBe("Warden blocked 3 redirects");
    expect(noticeText([block(), r, r])).toBe("Warden blocked 3 pop-ups and redirects");
  });
});

function setup(delivered = true) {
  let t = 10_000;
  let enabled = true;
  const send = vi.fn(async (_tabId: number, _text: string) => delivered);
  const notices = createNotices({ send, now: () => t, enabled: () => enabled });
  return {
    send,
    notices,
    advance: (ms: number) => {
      t += ms;
    },
    disable: () => {
      enabled = false;
    },
  };
}

describe("createNotices", () => {
  it("tells the opener tab right away when a pop-up was closed", async () => {
    const { send, notices } = setup();
    await notices.blocked(1, block());
    expect(send).toHaveBeenCalledWith(1, "Warden closed a pop-up to casino.example");
  });

  it("groups blocks close together on the same tab into one updated notice", async () => {
    const { send, notices, advance } = setup();
    await notices.blocked(1, block());
    advance(1000);
    await notices.blocked(1, block());
    expect(send).toHaveBeenLastCalledWith(1, "Warden closed 2 pop-ups");
    advance(NOTICE_GROUP_MS + 1);
    await notices.blocked(1, block());
    expect(send).toHaveBeenLastCalledWith(1, "Warden closed a pop-up to casino.example");
  });

  it("holds a redirect notice until the tab has gone back, then delivers it", async () => {
    const { send, notices } = setup();
    await notices.blocked(2, block({ kind: "redirect" }));
    expect(send).not.toHaveBeenCalled();
    expect(notices.poll(2)).toBeNull(); // the junk page itself must not get it
    await notices.committed(2);
    expect(send).toHaveBeenCalledWith(
      2,
      "Warden blocked a redirect to casino.example and brought you back",
    );
  });

  it("keeps an undelivered notice briefly for the page to collect when it loads", async () => {
    const { notices, advance } = setup(false);
    await notices.blocked(1, block());
    expect(notices.poll(1)).toBe("Warden closed a pop-up to casino.example");
    expect(notices.poll(1)).toBeNull(); // collected once

    await notices.blocked(1, block());
    advance(NOTICE_TTL_MS + 1);
    expect(notices.poll(1)).toBeNull(); // too old to be about this page
  });

  it("does nothing when notices are turned off", async () => {
    const { send, notices, disable } = setup(false);
    disable();
    await notices.blocked(1, block());
    expect(send).not.toHaveBeenCalled();
    expect(notices.poll(1)).toBeNull();
  });
});
