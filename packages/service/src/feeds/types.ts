import type { FeedId } from "@warden/shared/types";

/** One feed URL as the pipeline sees it. Times are milliseconds since epoch. */
export interface FeedRecord {
  url: string;
  source: FeedId;
  first_seen: number;
  last_seen: number;
}

/** HTTP caching state carried between polls. */
export interface PollState {
  etag?: string;
  lastModified?: string;
  lastPolledAt?: number;
}

export type PollResult =
  | { status: "updated"; urls: string[]; etag?: string; lastModified?: string }
  | { status: "not_modified" };

export interface Ingestor {
  id: FeedId;
  /** Polls closer together than this reuse the last result (rate limits, politeness). */
  minIntervalMs: number;
  poll(fetchFn: typeof fetch, state: PollState): Promise<PollResult>;
}

/** Conditional GET of a plain-text list, one URL per line. */
export async function pollTextList(
  fetchFn: typeof fetch,
  url: string,
  state: PollState,
): Promise<PollResult> {
  const headers: Record<string, string> = { "user-agent": "warden-feeds (personal project)" };
  if (state.etag) headers["if-none-match"] = state.etag;
  if (state.lastModified) headers["if-modified-since"] = state.lastModified;

  const res = await fetchFn(url, { headers });
  if (res.status === 304) return { status: "not_modified" };
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);

  const urls = parseUrlLines(await res.text());
  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  return {
    status: "updated",
    urls,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  };
}

export function parseUrlLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l));
}
