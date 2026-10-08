/**
 * Feed-quality log, one JSON file per run under `logs/quality/` (never served publicly).
 * Alerts when a feed's allowlist-drop ratio spikes: a feed suddenly listing popular sites
 * suggests poisoning or junk, and those entries would have been FPs.
 */
import type { CleanStats } from "./pipeline.ts";
import { type BlobStore, getJson, putJson } from "./storage.ts";

export interface FeedQuality extends Partial<CleanStats> {
  polled: boolean;
  not_modified: boolean;
  error?: string;
  /** dropped_allowlist / ingested. */
  allowlist_drop_ratio: number;
}

export interface QualityLog {
  run_at: number;
  published: boolean;
  version: number | null;
  allowlist: { refreshed: boolean; error?: string };
  feeds: Record<string, FeedQuality>;
  alerts: string[];
}

const HISTORY_KEY = "state/quality-history.json";
const HISTORY_LEN = 48;
const KEEP_LOGS = 24 * 30;
/** Ratios below this never alert, whatever the history. */
export const SPIKE_FLOOR = 0.05;
export const SPIKE_FACTOR = 3;
/** With too little history, alert only above this absolute ratio. */
export const COLD_START_RATIO = 0.2;

export function dropRatio(stats: Partial<CleanStats>): number {
  return stats.ingested ? (stats.dropped_allowlist ?? 0) / stats.ingested : 0;
}

/** True when `ratio` is a spike relative to `history` (older ratios for the same feed). */
export function isSpike(ratio: number, history: readonly number[]): boolean {
  if (ratio < SPIKE_FLOOR) return false;
  if (history.length < 3) return ratio >= COLD_START_RATIO;
  const sorted = [...history].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] as number;
  return ratio > SPIKE_FACTOR * Math.max(median, SPIKE_FLOOR / SPIKE_FACTOR);
}

/** Adds spike alerts to `log`, updates the ratio history, and writes the log. */
export async function recordQuality(store: BlobStore, log: QualityLog): Promise<QualityLog> {
  const history = (await getJson<Record<string, number[]>>(store, HISTORY_KEY)) ?? {};
  for (const [feed, q] of Object.entries(log.feeds)) {
    if (!q.ingested) continue;
    const past = history[feed] ?? [];
    if (isSpike(q.allowlist_drop_ratio, past)) {
      const samples = (q.allowlist_samples ?? []).slice(0, 5).join(", ");
      log.alerts.push(
        `${feed}: allowlist-drop ratio ${(q.allowlist_drop_ratio * 100).toFixed(1)}% ` +
          `(${q.dropped_allowlist}/${q.ingested}) is a spike. Samples: ${samples}`,
      );
    }
    history[feed] = [...past, q.allowlist_drop_ratio].slice(-HISTORY_LEN);
  }
  await putJson(store, HISTORY_KEY, history);
  await putJson(store, `logs/quality/${log.run_at}.json`, log);

  const logs = (await store.list("logs/quality/")).sort();
  for (const key of logs.slice(0, Math.max(0, logs.length - KEEP_LOGS))) await store.delete(key);
  return log;
}
