/**
 * Stage 1: deterministic feeds. Combines the local list lookup and Safe Browsing, which
 * run in parallel, using the decision rule in docs/fp-policy.md §5:
 *
 *  1. Safe Browsing hit → block (wins even over the allowlist).
 *  2. Allowlist hit (from Stage 0) → allow; local feeds aren't consulted.
 *  3. Tier A local hit → block.
 *  4. Tier B hit + any other source (another feed or SB) → block; Tier B alone → escalate.
 *  5. Otherwise → allow.
 *
 * Both lookups fail open: an error or timeout counts as "no hit".
 */
import { hasAllowlistHit } from "./allowlist.ts";
import { type CanonicalUrl, canonicalize } from "./canonicalize.ts";
import { capFeedDecision, maxDecision } from "./risk.ts";
import type { Decision, FeedId, FeedTier, Signal, Stage, StageResult } from "./types.ts";

export interface ListMatch {
  feed: FeedId;
  tier: FeedTier;
  /** The lookup expression that matched. */
  expression: string;
}

export interface LocalLists {
  match(url: CanonicalUrl, now: number): Promise<ListMatch[]>;
}

export interface SafeBrowsingVerdict {
  hit: boolean;
  /** Expressions whose full hash matched, for the signal log. */
  expressions: string[];
  /** Set when the lookup failed or timed out (treated as no hit). */
  error?: string;
}

export interface SafeBrowsing {
  check(url: CanonicalUrl): Promise<SafeBrowsingVerdict>;
}

export interface Stage1Deps {
  lists: LocalLists;
  /** Null when no proxy is configured: Safe Browsing is skipped. */
  safeBrowsing: SafeBrowsing | null;
  now?: () => number;
}

export function createStage1(deps: Stage1Deps): Stage {
  const now = deps.now ?? Date.now;

  return {
    id: "stage1_deterministic",
    async evaluate(ctx, prior): Promise<StageResult> {
      const url = canonicalize(ctx.url);
      if (!url) return result("allow", []);

      const allowlisted = hasAllowlistHit(prior);
      const errors: string[] = [];
      const [matches, sb] = await Promise.all([
        allowlisted
          ? Promise.resolve([] as ListMatch[])
          : deps.lists.match(url, now()).catch((err: unknown) => {
              errors.push(`lists: ${String(err)}`);
              return [] as ListMatch[];
            }),
        deps.safeBrowsing
          ? deps.safeBrowsing.check(url).catch(
              (err: unknown): SafeBrowsingVerdict => ({
                hit: false,
                expressions: [],
                error: String(err),
              }),
            )
          : Promise.resolve(null),
      ]);
      if (sb?.error) errors.push(`safe_browsing: ${sb.error}`);

      const signals: Signal[] = [];
      if (sb?.hit) {
        for (const expression of sb.expressions.length ? sb.expressions : [url.host + url.path]) {
          signals.push({ id: "sb_hit", source: "safe_browsing", tier: "A", expression });
        }
      }
      for (const m of matches) {
        signals.push({ id: "feed_hit", source: m.feed, tier: m.tier, expression: m.expression });
      }

      const out = result(decide(Boolean(sb?.hit), allowlisted, matches), signals);
      if (errors.length) out.error = errors.join("; ");
      return out;
    },
  };
}

/** The Stage 1 decision rule. Exported for the eval harness. */
export function decide(
  sbHit: boolean,
  allowlisted: boolean,
  matches: readonly ListMatch[],
): Decision {
  if (sbHit) return "block";
  if (allowlisted) return "allow";

  let decision: Decision = "allow";
  for (const m of matches) decision = maxDecision(decision, capFeedDecision(m.tier, "block"));

  // Tier B is confirmed by any second independent source (here: a different feed).
  const feeds = new Set(matches.map((m) => m.feed));
  if (decision === "escalate" && feeds.size >= 2) decision = "block";
  return decision;
}

function result(decision: Decision, signals: Signal[]): StageResult {
  return {
    decision,
    score: decision === "allow" ? 0 : 1,
    signals,
    latency_ms: 0,
    source: "stage1_deterministic",
  };
}
