/**
 * Runs one ingestor and merges the result into its persisted state. Every URL seen in the
 * last TTL window is returned with first_seen/last_seen; URLs not seen for TTL are dropped
 * from state. A failed poll keeps the previous state (fail-open: nothing new, nothing lost).
 */
import { type BlobStore, getJson, putJson } from "../storage.ts";
import type { FeedRecord, Ingestor, PollState } from "./types.ts";

export const ENTRY_TTL_MS = 10 * 24 * 60 * 60_000;

interface FeedState {
  poll: PollState;
  /** URLs from the most recent successful poll. */
  current: string[];
  seen: Record<string, { first_seen: number; last_seen: number }>;
}

export interface IngestOutcome {
  records: FeedRecord[];
  polled: boolean;
  notModified: boolean;
  /** Set when the poll failed; records then come from the previous state. */
  error?: string;
}

export const stateKey = (feed: string) => `state/feeds/${feed}.json`;

export async function ingest(
  ingestor: Ingestor,
  store: BlobStore,
  fetchFn: typeof fetch,
  now: number,
): Promise<IngestOutcome> {
  const state = (await getJson<FeedState>(store, stateKey(ingestor.id))) ?? {
    poll: {},
    current: [],
    seen: {},
  };

  let polled = false;
  let notModified = false;
  let error: string | undefined;
  const last = state.poll.lastPolledAt;
  const due = last === undefined || now - last >= ingestor.minIntervalMs;

  if (due) {
    try {
      const result = await ingestor.poll(fetchFn, state.poll);
      polled = true;
      state.poll.lastPolledAt = now;
      if (result.status === "updated") {
        state.current = [...new Set(result.urls)];
        state.poll = {
          lastPolledAt: now,
          ...(result.etag ? { etag: result.etag } : {}),
          ...(result.lastModified ? { lastModified: result.lastModified } : {}),
        };
      } else {
        notModified = true;
      }
      // Everything in the latest list counts as seen now, including on a 304.
      for (const url of state.current) {
        const prev = state.seen[url];
        state.seen[url] = { first_seen: prev?.first_seen ?? now, last_seen: now };
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  for (const [url, s] of Object.entries(state.seen)) {
    if (now - s.last_seen > ENTRY_TTL_MS) delete state.seen[url];
  }
  await putJson(store, stateKey(ingestor.id), state);

  const records = Object.entries(state.seen).map(([url, s]) => ({
    url,
    source: ingestor.id,
    ...s,
  }));
  return { records, polled, notModified, ...(error ? { error } : {}) };
}
