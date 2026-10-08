/**
 * Corpora for the Stage 1 baseline.
 *
 * Benign:
 * - `tranco-homepages`: `https://<domain>/` for the Tranco top N (default 100k);
 * - `tranco-login-paths`: `https://<domain>/login` for the top 2k: generated paths on real
 *   top domains, standing in for login pages at URL level;
 * - curated groups from `data/benign-logins.txt` (SSO, banks, universities, shared hosts).
 *
 * Phish: feed records with first_seen, either fetched live (one snapshot) or read from a
 * pipeline state directory (accumulated history, which enables a time split).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseTrancoCsv, TRANCO_BASE } from "@warden/service/allowlist-source";
import { ingest } from "@warden/service/feeds/ingest";
import type { FeedRecord } from "@warden/service/feeds/types";
import { INGESTORS } from "@warden/service/run";
import { memoryStore } from "@warden/service/storage";
import { FEED_IDS, type FeedId } from "@warden/shared/types";
import type { LabeledUrl } from "./evaluate.ts";

export async function fetchTranco(
  fetchFn: typeof fetch,
  topN: number,
): Promise<{ id: string; domains: string[] }> {
  const idRes = await fetchFn(`${TRANCO_BASE}/top-1m-id`);
  if (!idRes.ok) throw new Error(`tranco id: HTTP ${idRes.status}`);
  const id = (await idRes.text()).trim();
  const listRes = await fetchFn(`${TRANCO_BASE}/download/${id}/${topN}`);
  if (!listRes.ok) throw new Error(`tranco list: HTTP ${listRes.status}`);
  return { id, domains: parseTrancoCsv(await listRes.text()) };
}

export function trancoBenign(domains: readonly string[], loginPathCount = 2000): LabeledUrl[] {
  return [
    ...domains.map((d) => ({
      url: `https://${d}/`,
      label: "benign" as const,
      group: "tranco-homepages",
    })),
    ...domains.slice(0, loginPathCount).map((d) => ({
      url: `https://${d}/login`,
      label: "benign" as const,
      group: "tranco-login-paths",
    })),
  ];
}

/** Parses the curated list format: URLs, `# comments`, and `[group]` headers. */
export function parseCuratedList(text: string): LabeledUrl[] {
  const out: LabeledUrl[] = [];
  let group = "curated";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header = /^\[([a-z0-9-]+)\]$/.exec(line);
    if (header?.[1]) group = header[1];
    else if (/^https?:\/\//.test(line)) out.push({ url: line, label: "benign", group });
  }
  return out;
}

export async function loadCuratedBenign(file: string): Promise<LabeledUrl[]> {
  return parseCuratedList(await readFile(file, "utf8"));
}

/** Polls every feed once, regardless of the production enabled flags. */
export async function fetchPhishLive(
  fetchFn: typeof fetch,
  now: number,
): Promise<{
  records: FeedRecord[];
  errors: Partial<Record<FeedId, string>>;
}> {
  const store = memoryStore();
  const records: FeedRecord[] = [];
  const errors: Partial<Record<FeedId, string>> = {};
  for (const feed of FEED_IDS) {
    const out = await ingest(INGESTORS[feed], store, fetchFn, now);
    if (out.error) errors[feed] = out.error;
    for (const r of out.records) records.push(r); // can be 100k+: no spread
  }
  return { records, errors };
}

/** Reads accumulated feed history from a pipeline output directory (`state/feeds/*.json`). */
export async function loadPhishFromState(dir: string): Promise<FeedRecord[]> {
  const feedDir = path.join(dir, "state", "feeds");
  const records: FeedRecord[] = [];
  for (const file of await readdir(feedDir)) {
    const feed = file.replace(/\.json$/, "") as FeedId;
    if (!FEED_IDS.includes(feed)) continue;
    const state = JSON.parse(await readFile(path.join(feedDir, file), "utf8")) as {
      seen: Record<string, { first_seen: number; last_seen: number }>;
    };
    for (const [url, s] of Object.entries(state.seen)) records.push({ url, source: feed, ...s });
  }
  return records;
}

export interface TimeSplit {
  /** Lists are built from these. */
  train: FeedRecord[];
  /** Recall is measured on these: first seen at or after `cutoff`. */
  test: FeedRecord[];
  cutoff: number;
}

/**
 * Holds out the newest `fraction` of records by first_seen. Returns null when every record
 * was first seen at the same time (a single live snapshot), so no honest split exists.
 */
export function splitByTime(records: readonly FeedRecord[], fraction = 0.2): TimeSplit | null {
  if (records.length < 2) return null;
  const times = records.map((r) => r.first_seen).sort((a, b) => a - b);
  const cutoff = times[Math.floor(times.length * (1 - fraction))] as number;
  if (cutoff === times[0]) return null;
  return {
    train: records.filter((r) => r.first_seen < cutoff),
    test: records.filter((r) => r.first_seen >= cutoff),
    cutoff,
  };
}

export function phishUrls(records: readonly FeedRecord[]): LabeledUrl[] {
  return records.map((r) => ({ url: r.url, label: "phish", group: r.source }));
}
