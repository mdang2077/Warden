/**
 * Builds the Stage 0 allowlist from the latest Tranco list, at most once a day. The last
 * good list is kept in the store; if a refresh fails the old one stays in use.
 */
import { buildAllowlist, serializeAllowlist } from "@warden/shared/allowlist";
import type { SharedHostList } from "@warden/shared/shared-hosts";
import { type BlobStore, getJson, putJson } from "./storage.ts";

export const TRANCO_BASE = "https://tranco-list.eu";
export const ALLOWLIST_TOP_N = 100_000;
const REFRESH_MS = 24 * 60 * 60_000;
const STATE_KEY = "state/allowlist.json";
const TEXT_KEY = "state/allowlist.txt";

interface AllowlistState {
  trancoId: string;
  fetchedAt: number;
  count: number;
}

export interface AllowlistOutcome {
  /** Newline-separated registrable domains, or null if no list has ever been built. */
  text: string | null;
  refreshed: boolean;
  error?: string;
}

/** Parses Tranco CSV lines (`rank,domain`). */
export function parseTrancoCsv(csv: string): string[] {
  return csv
    .split("\n")
    .map((line) => line.trim().split(",")[1]?.trim() ?? "")
    .filter(Boolean);
}

export async function refreshAllowlist(
  store: BlobStore,
  fetchFn: typeof fetch,
  shared: SharedHostList,
  now: number,
  topN = ALLOWLIST_TOP_N,
): Promise<AllowlistOutcome> {
  const state = await getJson<AllowlistState>(store, STATE_KEY);
  const existing = await store.get(TEXT_KEY);
  if (state && existing && now - state.fetchedAt < REFRESH_MS) {
    return { text: existing, refreshed: false };
  }

  try {
    const idRes = await fetchFn(`${TRANCO_BASE}/top-1m-id`);
    if (!idRes.ok) throw new Error(`tranco id returned ${idRes.status}`);
    const trancoId = (await idRes.text()).trim();
    if (!/^[A-Z0-9]+$/i.test(trancoId)) throw new Error(`unexpected tranco id ${trancoId}`);

    const listRes = await fetchFn(`${TRANCO_BASE}/download/${trancoId}/${topN}`);
    if (!listRes.ok) throw new Error(`tranco list returned ${listRes.status}`);
    const domains = buildAllowlist(parseTrancoCsv(await listRes.text()), shared, topN);
    // A truncated download would silently shrink the allowlist and raise FP risk.
    if (domains.length < topN * 0.5) throw new Error(`tranco list too short: ${domains.length}`);

    const text = serializeAllowlist(domains);
    await store.put(TEXT_KEY, text, "text/plain");
    await putJson(store, STATE_KEY, { trancoId, fetchedAt: now, count: domains.length });
    return { text, refreshed: true };
  } catch (err) {
    return {
      text: existing,
      refreshed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
