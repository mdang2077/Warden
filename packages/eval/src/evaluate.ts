/**
 * Runs the production cascade (Stage 0 allowlist + Stage 1 deterministic) over a set of
 * labeled URLs. Safe Browsing is off: the harness is offline and measures Warden's own
 * lists. Results keep the signals so the report can attribute every flag to a feed.
 */
import { type Allowlist, createAllowlistStage } from "@warden/shared/allowlist";
import { runCascade } from "@warden/shared/cascade";
import type { SharedHostList } from "@warden/shared/shared-hosts";
import { createStage1, type LocalLists } from "@warden/shared/stage1";
import type { Decision, FeedId, Stage } from "@warden/shared/types";

export type Label = "benign" | "phish";

export interface LabeledUrl {
  url: string;
  label: Label;
  /** Corpus name (benign) or source feed (phish). */
  group: string;
}

export interface UrlResult extends LabeledUrl {
  decision: Decision;
  /** Feeds whose entries matched. */
  feeds: FeedId[];
  allowlisted: boolean;
}

export interface EvalSetup {
  lists: LocalLists;
  /** Null runs the ablation with no allowlist at all. */
  allowlist: Allowlist | null;
  shared: SharedHostList;
}

export function stagesFor(setup: EvalSetup): Stage[] {
  return [
    createAllowlistStage({
      allowlist: () => setup.allowlist,
      userDomains: () => new Set(),
      shared: () => setup.shared,
    }),
    createStage1({ lists: setup.lists, safeBrowsing: null }),
  ];
}

export async function evaluateUrls(
  urls: readonly LabeledUrl[],
  setup: EvalSetup,
  onProgress?: (done: number) => void,
): Promise<UrlResult[]> {
  const stages = stagesFor(setup);
  const out: UrlResult[] = [];
  for (const item of urls) {
    const ctx = { url: item.url, tabId: 0, redirectChain: [], startedAt: 0 };
    // Generous budget: this measures decisions, not latency.
    const result = await runCascade(stages, ctx, { budgetMs: 60_000 });
    const signals = result.results.flatMap((r) => r.signals);
    out.push({
      ...item,
      decision: result.decision,
      feeds: [
        ...new Set(signals.filter((s) => s.id === "feed_hit").map((s) => s.source as FeedId)),
      ],
      allowlisted: signals.some((s) => s.id === "allowlist_hit"),
    });
    if (onProgress && out.length % 5000 === 0) onProgress(out.length);
  }
  return out;
}
