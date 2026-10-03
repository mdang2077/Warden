import type { Stage } from "@warden/shared/types";
import { describe, expect, it, vi } from "vitest";
import { createNavigationHandler } from "./handler.ts";

const blockAll: Stage = {
  id: "stage1_deterministic",
  evaluate: async () => ({
    decision: "block",
    score: 1,
    signals: [{ id: "feed_hit", source: "openphish", tier: "A" }],
    latency_ms: 0,
    source: "stage1_deterministic",
  }),
};

const allowAll: Stage = {
  id: "stage1_deterministic",
  evaluate: async () => ({
    decision: "allow",
    score: 0,
    signals: [],
    latency_ms: 0,
    source: "stage1_deterministic",
  }),
};

function deps(stages: Stage[], bypassed = false) {
  return {
    stages: () => stages,
    onBlock: vi.fn(),
    isBypassed: vi.fn(async () => bypassed),
    onResult: vi.fn(),
  };
}

function nav(url: string, frameId = 0, tabId = 1) {
  return { url, frameId, tabId, timeStamp: 0 };
}

describe("createNavigationHandler", () => {
  it("blocks top-frame http(s) navigations with the blocking sources", async () => {
    const d = deps([blockAll]);
    const out = await createNavigationHandler(d)(nav("https://phish.example/"));
    expect(out?.decision).toBe("block");
    expect(d.onBlock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://phish.example/" }),
      ["openphish"],
    );
  });

  it("does not show the interstitial for a bypassed URL", async () => {
    const d = deps([blockAll], true);
    await createNavigationHandler(d)(nav("https://phish.example/"));
    expect(d.isBypassed).toHaveBeenCalledWith("https://phish.example/", ["openphish"]);
    expect(d.onBlock).not.toHaveBeenCalled();
  });

  it("ignores subframes and skipped URLs", async () => {
    const d = deps([blockAll]);
    const handle = createNavigationHandler(d);
    expect(await handle(nav("https://phish.example/", 3))).toBeNull();
    expect(await handle(nav("chrome://newtab/"))).toBeNull();
    expect(await handle(nav("http://192.168.0.1/"))).toBeNull();
    expect(d.onResult).not.toHaveBeenCalled();
  });

  it("dedupes allowed URLs in the same tab within the window", async () => {
    let t = 0;
    const d = deps([allowAll]);
    const handle = createNavigationHandler({ ...d, now: () => t });
    await handle(nav("https://ok.example/"));
    t = 1000;
    expect(await handle(nav("https://ok.example/"))).toBeNull();
    expect(await handle(nav("https://ok.example/", 0, 2))).not.toBeNull();
    t = 5000;
    expect(await handle(nav("https://ok.example/"))).not.toBeNull();
    expect(d.onResult).toHaveBeenCalledTimes(3);
  });

  it("never dedupes a block", async () => {
    const d = deps([blockAll]);
    const handle = createNavigationHandler({ ...d, now: () => 0 });
    await handle(nav("https://phish.example/"));
    await handle(nav("https://phish.example/"));
    expect(d.onBlock).toHaveBeenCalledTimes(2);
  });
});
