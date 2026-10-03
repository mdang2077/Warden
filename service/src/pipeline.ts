/**
 * Cleaning pipeline: canonicalize → drop allowlisted → drop shared-host bare hosts →
 * dedupe → TTL. Uses the same shared/ code as the extension, so an entry the service
 * publishes is matched exactly the way the client expects.
 */
import type { Allowlist } from "@warden/shared/allowlist";
import { canonicalize } from "@warden/shared/canonicalize";
import { entryExpression, hashExpressions } from "@warden/shared/expressions";
import { isEntryAllowed, type SharedHostList } from "@warden/shared/shared-hosts";
import { ENTRY_TTL_MS } from "./feeds/ingest.ts";
import type { FeedRecord } from "./feeds/types.ts";

export interface CleanEntry {
  /** Canonical expression: host + path [+ ?query]. */
  expression: string;
  /** Full SHA-256 of the expression, hex. */
  hash: string;
  first_seen: number;
  last_seen: number;
  /** last_seen + TTL: clients ignore the entry after this. */
  expiresAt: number;
}

export interface CleanStats {
  ingested: number;
  invalid: number;
  dropped_allowlist: number;
  dropped_shared_host: number;
  dropped_ttl: number;
  duplicates: number;
  kept: number;
  /** Up to MAX_SAMPLES allowlist drops, for the feed-quality log. */
  allowlist_samples: string[];
}

const MAX_SAMPLES = 20;

export interface CleanOptions {
  allowlist: Allowlist;
  shared: SharedHostList;
  now: number;
  ttlMs?: number;
}

export async function cleanFeed(
  records: readonly FeedRecord[],
  options: CleanOptions,
): Promise<{ entries: CleanEntry[]; stats: CleanStats }> {
  const ttl = options.ttlMs ?? ENTRY_TTL_MS;
  const stats: CleanStats = {
    ingested: records.length,
    invalid: 0,
    dropped_allowlist: 0,
    dropped_shared_host: 0,
    dropped_ttl: 0,
    duplicates: 0,
    kept: 0,
    allowlist_samples: [],
  };

  const byExpression = new Map<string, { first_seen: number; last_seen: number }>();
  for (const r of records) {
    const url = canonicalize(r.url);
    if (!url || (url.scheme !== "http" && url.scheme !== "https")) {
      stats.invalid++;
      continue;
    }
    // Shared hosts are never allowlisted, so path-specific entries on them pass this check.
    if (options.allowlist.allows(url.host)) {
      stats.dropped_allowlist++;
      if (stats.allowlist_samples.length < MAX_SAMPLES) stats.allowlist_samples.push(r.url);
      continue;
    }
    if (!isEntryAllowed(url, options.shared)) {
      stats.dropped_shared_host++;
      continue;
    }
    if (options.now - r.last_seen > ttl) {
      stats.dropped_ttl++;
      continue;
    }

    const expression = entryExpression(url);
    const prev = byExpression.get(expression);
    if (prev) {
      stats.duplicates++;
      prev.first_seen = Math.min(prev.first_seen, r.first_seen);
      prev.last_seen = Math.max(prev.last_seen, r.last_seen);
    } else {
      byExpression.set(expression, { first_seen: r.first_seen, last_seen: r.last_seen });
    }
  }

  const hashed = await hashExpressions([...byExpression.keys()]);
  const entries = hashed
    .map(({ expression, hash }) => {
      const seen = byExpression.get(expression) as { first_seen: number; last_seen: number };
      return { expression, hash, ...seen, expiresAt: seen.last_seen + ttl };
    })
    .sort((a, b) => a.hash.localeCompare(b.hash));
  stats.kept = entries.length;
  return { entries, stats };
}
