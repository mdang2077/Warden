import { describe, expect, it } from "vitest";
import { runCascade } from "./cascade.ts";
import type {
  NavigationContext,
  Stage,
  StageId,
  StageResult,
} from "./types.ts";

const ctx: NavigationContext = {
  url: "https://example.com/",
  tabId: 1,
  redirectChain: [],
  startedAt: 0,
};

function stage(
  id: StageId,
  result: Partial<StageResult> | (() => Promise<StageResult>),
): Stage & { calls: number } {
  const s = {
    id,
    calls: 0,
    async evaluate() {
      s.calls++;
      if (typeof result === "function") return result();
      return {
        decision: "allow",
        score: 0,
        signals: [],
        latency_ms: 0,
        source: id,
        ...result,
      };
    },
  } as Stage & { calls: number };
  return s;
}

describe("runCascade", () => {
  it("allows when no stage objects", async () => {
    const out = await runCascade(
      [stage("stage0_allowlist", {}), stage("stage1_deterministic", {})],
      ctx,
      { budgetMs: 1000 },
    );
    expect(out.decision).toBe("allow");
    expect(out.results).toHaveLength(2);
    expect(out.timed_out).toBe(false);
  });

  it("stops after a block", async () => {
    const later = stage("stage2_heuristics", {});
    const out = await runCascade(
      [stage("stage1_deterministic", { decision: "block" }), later],
      ctx,
      { budgetMs: 1000 },
    );
    expect(out.decision).toBe("block");
    expect(later.calls).toBe(0);
  });

  it("stops after a final result", async () => {
    const later = stage("stage1_deterministic", {});
    const out = await runCascade(
      [stage("stage0_allowlist", { final: true }), later],
      ctx,
      {
        budgetMs: 1000,
      },
    );
    expect(out.decision).toBe("allow");
    expect(later.calls).toBe(0);
  });

  it("caps each stage's decision", async () => {
    const out = await runCascade(
      [stage("stage2_heuristics", { decision: "block" })],
      ctx,
      {
        budgetMs: 1000,
      },
    );
    expect(out.decision).toBe("warn");
    expect(out.results[0]?.capped_from).toBe("block");
  });

  it("takes the most severe decision across stages", async () => {
    const out = await runCascade(
      [
        stage("stage1_deterministic", { decision: "escalate" }),
        stage("stage2_heuristics", { decision: "allow" }),
      ],
      ctx,
      { budgetMs: 1000 },
    );
    expect(out.decision).toBe("escalate");
  });

  it("fails open when a stage throws", async () => {
    const later = stage("stage2_heuristics", {});
    const out = await runCascade(
      [
        stage("stage1_deterministic", () =>
          Promise.reject(new Error("idb unavailable")),
        ),
        later,
      ],
      ctx,
      { budgetMs: 1000 },
    );
    expect(out.decision).toBe("allow");
    expect(out.results[0]?.error).toContain("idb unavailable");
    expect(later.calls).toBe(1);
  });

  it("fails open and stops when the budget runs out", async () => {
    const slowBlock = stage(
      "stage1_deterministic",
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                decision: "block",
                score: 1,
                signals: [],
                latency_ms: 0,
                source: "stage1_deterministic",
              }),
            200,
          ),
        ),
    );
    const later = stage("stage2_heuristics", {});
    const out = await runCascade([slowBlock, later], ctx, { budgetMs: 20 });
    expect(out.decision).toBe("allow");
    expect(out.timed_out).toBe(true);
    expect(out.results[0]?.error).toBe("timeout");
    expect(later.calls).toBe(0);
  });

  it("records per-stage latency measured by the runner", async () => {
    let t = 0;
    const out = await runCascade(
      [
        stage("stage0_allowlist", () => {
          t += 3;
          return Promise.resolve({
            decision: "allow",
            score: 0,
            signals: [],
            latency_ms: 999,
            source: "stage0_allowlist",
          });
        }),
      ],
      ctx,
      { budgetMs: 1000, now: () => t },
    );
    expect(out.results[0]?.latency_ms).toBe(3);
    expect(out.total_ms).toBe(3);
  });
});
