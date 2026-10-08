/**
 * Core cascade types shared by the extension, the feed service, and the eval harness.
 * See docs/fp-policy.md for what each decision means and who may emit it.
 */

/** Decisions ordered from least to most severe. Order matters: `risk.ts` ranks by index. */
export const DECISIONS = ["allow", "escalate", "warn", "block"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Cascade stages, cheapest first. */
export const STAGE_IDS = [
  "stage0_allowlist",
  "stage1_deterministic",
  "stage2_heuristics",
  "stage3_llm",
] as const;
export type StageId = (typeof STAGE_IDS)[number];

/** Feed confidence tier. Tier A may block alone; Tier B alone is capped at `escalate`. */
export type FeedTier = "A" | "B";

/** Local blocklist feeds the service publishes. Safe Browsing is queried live instead. */
export const FEED_IDS = ["openphish", "phishing_database", "phishstats"] as const;
export type FeedId = (typeof FEED_IDS)[number];

/** Where a decision or signal came from. */
export type SourceId = "allowlist" | "user_override" | "safe_browsing" | FeedId;

/** One piece of evidence behind a decision. */
export interface Signal {
  /** Machine-readable signal name, e.g. `feed_hit`, `sb_hit`, `allowlist_hit`. */
  id: string;
  source: SourceId;
  /** Feed tier, for feed-derived signals. */
  tier?: FeedTier;
  /** The URL expression that matched, when there is one. */
  expression?: string;
}

/** What a single stage reports for one navigation. */
export interface StageResult {
  decision: Decision;
  /** Stage confidence in [0, 1]. Deterministic stages use 0 or 1. */
  score: number;
  signals: Signal[];
  latency_ms: number;
  /** The stage that produced this result. */
  source: StageId;
  /** Set by `risk.ts` when the stage emitted something above its cap. */
  capped_from?: Decision;
  /** True when no later stage should run. `block` always stops. */
  final?: boolean;
  /** Set by the cascade runner when the stage threw or timed out (fail-open to `allow`). */
  error?: string;
}

/** Input to every stage: one top-frame navigation hop. */
export interface NavigationContext {
  /** URL of this hop, as reported by the browser. */
  url: string;
  tabId: number;
  /** Earlier top-frame hops in the same navigation, oldest first. */
  redirectChain: string[];
  /** Milliseconds since epoch when the navigation started. */
  startedAt: number;
}

export interface Stage {
  readonly id: StageId;
  /** `prior` holds the results of the stages that already ran for this hop, in order. */
  evaluate(ctx: NavigationContext, prior: readonly StageResult[]): Promise<StageResult>;
}
