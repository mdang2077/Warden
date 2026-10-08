/**
 * In-memory version of the extension's list store: feed records go through the service's
 * cleaning pipeline (the same one that publishes snapshots), and lookups use the same
 * shared-host-protected expressions as the client. Only the storage differs.
 */

import type { FeedConfig } from "@warden/service/config";
import type { FeedRecord } from "@warden/service/feeds/types";
import { type CleanStats, cleanFeed } from "@warden/service/pipeline";
import type { Allowlist } from "@warden/shared/allowlist";
import type { CanonicalUrl } from "@warden/shared/canonicalize";
import { hashExpressions } from "@warden/shared/expressions";
import { protectedLookupExpressions, type SharedHostList } from "@warden/shared/shared-hosts";
import type { ListMatch, LocalLists } from "@warden/shared/stage1";
import type { FeedId, FeedTier } from "@warden/shared/types";

export interface MemoryLists extends LocalLists {
  /** Cleaning stats per feed, for the report. */
  stats: Partial<Record<FeedId, CleanStats>>;
  /** Entry count per feed after cleaning. */
  sizes: Partial<Record<FeedId, number>>;
}

export async function buildMemoryLists(
  records: readonly FeedRecord[],
  config: FeedConfig,
  allowlist: Allowlist,
  shared: SharedHostList,
  now: number,
): Promise<MemoryLists> {
  const byHash = new Map<string, { feed: FeedId; tier: FeedTier }[]>();
  const stats: MemoryLists["stats"] = {};
  const sizes: MemoryLists["sizes"] = {};

  for (const feed of Object.keys(config) as FeedId[]) {
    if (!config[feed].enabled) continue;
    const feedRecords = records.filter((r) => r.source === feed);
    const cleaned = await cleanFeed(feedRecords, { allowlist, shared, now });
    stats[feed] = cleaned.stats;
    sizes[feed] = cleaned.entries.length;
    for (const e of cleaned.entries) {
      const list = byHash.get(e.hash) ?? [];
      list.push({ feed, tier: config[feed].tier });
      byHash.set(e.hash, list);
    }
  }

  return {
    stats,
    sizes,
    async match(url: CanonicalUrl): Promise<ListMatch[]> {
      const hashed = await hashExpressions(protectedLookupExpressions(url, shared));
      return hashed.flatMap((h) =>
        (byHash.get(h.hash) ?? []).map((m) => ({ ...m, expression: h.expression })),
      );
    },
  };
}
