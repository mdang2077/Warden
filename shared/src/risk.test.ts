import { describe, expect, it } from "vitest";
import {
  capDecision,
  capFeedDecision,
  capStageResult,
  maxDecision,
  minDecision,
  STAGE_CAPS,
} from "./risk.ts";
import { DECISIONS, type Decision, STAGE_IDS, type StageResult } from "./types.ts";

function result(source: StageResult["source"], decision: Decision): StageResult {
  return { decision, score: 1, signals: [], latency_ms: 0, source };
}

describe("decision ordering", () => {
  it("ranks allow < escalate < warn < block", () => {
    expect(maxDecision("allow", "escalate")).toBe("escalate");
    expect(maxDecision("warn", "escalate")).toBe("warn");
    expect(maxDecision("block", "warn")).toBe("block");
    expect(minDecision("block", "allow")).toBe("allow");
  });

  it("caps never raise a decision", () => {
    for (const d of DECISIONS) {
      for (const cap of DECISIONS) {
        expect(capDecision(d, cap)).toBe(minDecision(d, cap));
      }
    }
    expect(capDecision("allow", "block")).toBe("allow");
  });
});

describe("feed tier caps", () => {
  it("clamps a Tier B block to escalate", () => {
    expect(capFeedDecision("B", "block")).toBe("escalate");
    expect(capFeedDecision("B", "warn")).toBe("escalate");
  });

  it("lets Tier A block", () => {
    expect(capFeedDecision("A", "block")).toBe("block");
  });
});

describe("stage caps", () => {
  it("only Stage 1 may block", () => {
    const blockers = STAGE_IDS.filter((s) => STAGE_CAPS[s] === "block");
    expect(blockers).toEqual(["stage1_deterministic"]);
  });

  it("clamps the allowlist stage to allow", () => {
    const capped = capStageResult(result("stage0_allowlist", "block"));
    expect(capped.decision).toBe("allow");
    expect(capped.capped_from).toBe("block");
  });

  it("clamps Stage 2 and Stage 3 blocks to warn", () => {
    expect(capStageResult(result("stage2_heuristics", "block")).decision).toBe("warn");
    expect(capStageResult(result("stage3_llm", "block")).decision).toBe("warn");
  });

  it("leaves results at or below the cap untouched", () => {
    const r = result("stage1_deterministic", "block");
    expect(capStageResult(r)).toBe(r);
    const s2 = result("stage2_heuristics", "escalate");
    expect(capStageResult(s2)).toBe(s2);
  });
});
