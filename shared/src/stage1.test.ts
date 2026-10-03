import { describe, expect, it } from "vitest";
import { createStage1, decide, type ListMatch, type SafeBrowsing } from "./stage1.ts";
import type { NavigationContext, StageResult } from "./types.ts";

const A: ListMatch = { feed: "openphish", tier: "A", expression: "evil.example/" };
const B1: ListMatch = { feed: "phishing_database", tier: "B", expression: "evil.example/" };
const B2: ListMatch = { feed: "phishstats", tier: "B", expression: "evil.example/a" };

const ALLOWLIST_HIT: StageResult = {
  decision: "allow",
  score: 1,
  signals: [{ id: "allowlist_hit", source: "allowlist" }],
  latency_ms: 0,
  source: "stage0_allowlist",
};

function ctx(url = "https://evil.example/a"): NavigationContext {
  return { url, tabId: 1, redirectChain: [], startedAt: 0 };
}

function sb(hit: boolean, error?: string): SafeBrowsing {
  return {
    check: async () => ({
      hit,
      expressions: hit ? ["evil.example/a"] : [],
      ...(error ? { error } : {}),
    }),
  };
}

describe("decide", () => {
  it.each([
    [false, false, [], "allow"],
    [false, false, [A], "block"],
    [false, false, [B1], "escalate"],
    [false, false, [B1, B2], "block"],
    [false, false, [A, B1], "block"],
    [true, false, [], "block"],
    [true, false, [B1], "block"],
    [true, true, [], "block"],
    [false, true, [A], "allow"],
  ] as const)("sb=%s allowlisted=%s %j → %s", (sbHit, allowlisted, matches, expected) => {
    expect(decide(sbHit, allowlisted, matches)).toBe(expected);
  });

  it("two hits from the same Tier B feed are not independent", () => {
    expect(decide(false, false, [B1, { ...B1, expression: "evil.example/a" }])).toBe("escalate");
  });
});

describe("Stage 1 evaluate", () => {
  it("blocks on a Tier A local hit with a feed signal", async () => {
    const stage = createStage1({ lists: { match: async () => [A] }, safeBrowsing: sb(false) });
    const r = await stage.evaluate(ctx(), []);
    expect(r.decision).toBe("block");
    expect(r.signals).toEqual([
      { id: "feed_hit", source: "openphish", tier: "A", expression: "evil.example/" },
    ]);
  });

  it("escalates on Tier B alone and blocks when SB confirms it", async () => {
    const alone = createStage1({ lists: { match: async () => [B1] }, safeBrowsing: sb(false) });
    expect((await alone.evaluate(ctx(), [])).decision).toBe("escalate");
    const confirmed = createStage1({ lists: { match: async () => [B1] }, safeBrowsing: sb(true) });
    const r = await confirmed.evaluate(ctx(), []);
    expect(r.decision).toBe("block");
    expect(r.signals.map((s) => s.source).sort()).toEqual(["phishing_database", "safe_browsing"]);
  });

  it("skips local feeds after an allowlist hit, but SB still wins", async () => {
    let listsCalled = false;
    const lists = {
      match: async () => {
        listsCalled = true;
        return [A];
      },
    };
    const noSb = createStage1({ lists, safeBrowsing: sb(false) });
    expect((await noSb.evaluate(ctx(), [ALLOWLIST_HIT])).decision).toBe("allow");
    expect(listsCalled).toBe(false);

    const withSb = createStage1({ lists, safeBrowsing: sb(true) });
    expect((await withSb.evaluate(ctx(), [ALLOWLIST_HIT])).decision).toBe("block");
  });

  it("fails open when the local lists throw", async () => {
    const stage = createStage1({
      lists: { match: async () => Promise.reject(new Error("idb gone")) },
      safeBrowsing: sb(false),
    });
    const r = await stage.evaluate(ctx(), []);
    expect(r.decision).toBe("allow");
    expect(r.error).toContain("idb gone");
  });

  it("fails open when SB errors, keeping local results", async () => {
    const stage = createStage1({
      lists: { match: async () => [B1] },
      safeBrowsing: sb(false, "timeout"),
    });
    const r = await stage.evaluate(ctx(), []);
    expect(r.decision).toBe("escalate");
    expect(r.error).toContain("safe_browsing: timeout");
  });

  it("fails open when SB throws", async () => {
    const stage = createStage1({
      lists: { match: async () => [] },
      safeBrowsing: { check: () => Promise.reject(new Error("network")) },
    });
    expect((await stage.evaluate(ctx(), [])).decision).toBe("allow");
  });

  it("works without a Safe Browsing proxy", async () => {
    const stage = createStage1({ lists: { match: async () => [A] }, safeBrowsing: null });
    expect((await stage.evaluate(ctx(), [])).decision).toBe("block");
  });

  it("allows URLs it can't canonicalize", async () => {
    const stage = createStage1({ lists: { match: async () => [A] }, safeBrowsing: sb(true) });
    expect((await stage.evaluate(ctx("http://"), [])).decision).toBe("allow");
  });
});
