/**
 * Remote feed config and kill switch. Stored at `config/feeds.json`; the Worker merges it
 * into every manifest it serves, so a change reaches clients on their next sync even
 * before the next publish run.
 */
import type { FeedSettings } from "@warden/shared/feed-format";
import { FEED_IDS, type FeedId } from "@warden/shared/types";
import { type BlobStore, getJson, putJson } from "./storage.ts";

export type FeedConfig = Record<FeedId, FeedSettings>;

export const CONFIG_KEY = "config/feeds.json";

/** Tier B feeds start disabled until they pass the Phase 4 FP gate. */
export const DEFAULT_FEED_CONFIG: Readonly<FeedConfig> = {
  openphish: { enabled: true, tier: "A" },
  phishing_database: { enabled: false, tier: "B" },
  phishstats: { enabled: false, tier: "B" },
};

/** Validates a partial config, falling back to defaults field by field. Never throws. */
export function normalizeConfig(raw: unknown): FeedConfig {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as FeedConfig;
  for (const feed of FEED_IDS) {
    const def = DEFAULT_FEED_CONFIG[feed];
    const given = (input[feed] && typeof input[feed] === "object" ? input[feed] : {}) as Record<
      string,
      unknown
    >;
    out[feed] = {
      enabled: typeof given.enabled === "boolean" ? given.enabled : def.enabled,
      tier: given.tier === "A" || given.tier === "B" ? given.tier : def.tier,
    };
  }
  return out;
}

export async function loadConfig(store: BlobStore): Promise<FeedConfig> {
  try {
    return normalizeConfig(await getJson(store, CONFIG_KEY));
  } catch {
    // Unreadable config: defaults (OpenPhish only) are the conservative choice.
    return normalizeConfig(null);
  }
}

export async function saveConfig(store: BlobStore, raw: unknown): Promise<FeedConfig> {
  const config = normalizeConfig(raw);
  await putJson(store, CONFIG_KEY, config);
  return config;
}

export function enabledFeeds(config: FeedConfig): FeedId[] {
  return FEED_IDS.filter((f) => config[f].enabled);
}
