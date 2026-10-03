import type { Ingestor, PollResult } from "./types.ts";

/**
 * PhishStats JSON API. ML-scored, so Tier B and disabled by default; only entries at or
 * above `minScore` are kept. The free API allows ~50 requests/day per IP, so this polls
 * at most every 2 h (12/day).
 *
 * Check the endpoint and field names against the current API docs before enabling.
 */
export const PHISHSTATS_URL = "https://api.phishstats.info/api/phishing?_sort=-date&_size=100";

export interface PhishStatsOptions {
  url?: string;
  /** PhishStats score threshold (0-10). To be chosen from the Phase 4 run. */
  minScore?: number;
}

export function createPhishStats(options: PhishStatsOptions = {}): Ingestor {
  const url = options.url ?? PHISHSTATS_URL;
  const minScore = options.minScore ?? 7;
  return {
    id: "phishstats",
    minIntervalMs: 2 * 60 * 60_000,
    async poll(fetchFn): Promise<PollResult> {
      const res = await fetchFn(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      const rows = (await res.json()) as { url?: unknown; score?: unknown }[];
      if (!Array.isArray(rows)) throw new Error("phishstats: expected an array");
      const urls = rows
        .filter((r) => typeof r.url === "string" && Number(r.score) >= minScore)
        .map((r) => r.url as string)
        .filter((u) => /^https?:\/\//i.test(u));
      return { status: "updated", urls };
    },
  };
}
