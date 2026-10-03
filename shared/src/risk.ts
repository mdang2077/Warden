/**
 * Decision capping: the block-authority table from docs/fp-policy.md, enforced in code.
 * Anything a stage or feed emits above its cap is clamped down to the cap.
 */
import {
  DECISIONS,
  type Decision,
  type FeedTier,
  type StageId,
  type StageResult,
} from "./types.ts";

/** Maximum decision each stage may emit. */
export const STAGE_CAPS: Readonly<Record<StageId, Decision>> = {
  stage0_allowlist: "allow",
  stage1_deterministic: "block",
  stage2_heuristics: "warn",
  stage3_llm: "warn",
};

/** Maximum decision a single feed hit may produce on its own. */
export const TIER_CAPS: Readonly<Record<FeedTier, Decision>> = {
  A: "block",
  B: "escalate",
};

export function decisionRank(decision: Decision): number {
  return DECISIONS.indexOf(decision);
}

export function maxDecision(a: Decision, b: Decision): Decision {
  return decisionRank(a) >= decisionRank(b) ? a : b;
}

export function minDecision(a: Decision, b: Decision): Decision {
  return decisionRank(a) <= decisionRank(b) ? a : b;
}

export function capDecision(decision: Decision, cap: Decision): Decision {
  return minDecision(decision, cap);
}

/** Decision a single feed hit may produce on its own, given the feed's tier. */
export function capFeedDecision(tier: FeedTier, decision: Decision): Decision {
  return capDecision(decision, TIER_CAPS[tier]);
}

/** Clamp a stage result to its stage's cap, recording the original decision if clamped. */
export function capStageResult(result: StageResult): StageResult {
  const capped = capDecision(result.decision, STAGE_CAPS[result.source]);
  if (capped === result.decision) return result;
  return { ...result, decision: capped, capped_from: result.decision };
}
