/**
 * One pipeline run: config → allowlist → ingest + clean each enabled feed → publish →
 * quality log. Platform-neutral; the Worker cron and the Node CLI both call this.
 */
import { parseAllowlist } from "@warden/shared/allowlist";
import { bundledPopupNetworksFile } from "@warden/shared/popup-networks";
import { bundledSharedHosts, bundledSharedHostsFile } from "@warden/shared/shared-hosts";
import type { FeedId } from "@warden/shared/types";
import { refreshAllowlist } from "./allowlist-source.ts";
import { enabledFeeds, loadConfig } from "./config.ts";
import { certPl } from "./feeds/cert-pl.ts";
import { ingest } from "./feeds/ingest.ts";
import { openphish } from "./feeds/openphish.ts";
import { phishingDatabase } from "./feeds/phishing-database.ts";
import { createPhishStats } from "./feeds/phishstats.ts";
import type { Ingestor } from "./feeds/types.ts";
import { type CleanEntry, cleanFeed } from "./pipeline.ts";
import { refreshPopupNetworks } from "./popup-networks-source.ts";
import { publish } from "./publish.ts";
import { dropRatio, type QualityLog, recordQuality } from "./quality.ts";
import { type ManifestSigner, resignManifest } from "./signing.ts";
import type { BlobStore } from "./storage.ts";
import { loadSuppressed } from "./suppress.ts";

export const INGESTORS: Record<FeedId, Ingestor> = {
  openphish,
  phishing_database: phishingDatabase,
  phishstats: createPhishStats(),
  cert_pl: certPl,
};

export interface RunOptions {
  store: BlobStore;
  fetch: typeof fetch;
  now: number;
  ingestors?: Record<FeedId, Ingestor>;
  /** Optional webhook that receives `{ text }` for each alert. */
  alertWebhook?: string;
  /** Publish `eval_only` feeds too (WARDEN_DEV_FEEDS=1; the store must be the dev prefix). */
  devFeeds?: boolean;
  /**
   * Signs the published manifest (publish-time signing, signing.ts). `null`: no signing key
   * configured, which raises an alert; omitted: signing isn't part of this run (tests).
   */
  signer?: ManifestSigner | null;
}

export async function runPipeline(options: RunOptions): Promise<QualityLog> {
  const { store, now } = options;
  const ingestors = options.ingestors ?? INGESTORS;
  const config = await loadConfig(store);
  const log: QualityLog = {
    run_at: now,
    published: false,
    version: null,
    allowlist: { refreshed: false },
    feeds: {},
    alerts: [],
  };

  const allowlistOut = await refreshAllowlist(store, options.fetch, bundledSharedHosts, now);
  log.allowlist = {
    refreshed: allowlistOut.refreshed,
    ...(allowlistOut.error ? { error: allowlistOut.error } : {}),
  };
  if (allowlistOut.text === null) {
    // Cleaning without an allowlist would let feed entries on popular sites through.
    log.alerts.push(`no allowlist available, nothing published: ${allowlistOut.error ?? "?"}`);
    return finish(options, log);
  }
  const allowlist = parseAllowlist(allowlistOut.text, bundledSharedHosts);

  const feeds: Partial<Record<FeedId, CleanEntry[]>> = {};
  for (const feed of enabledFeeds(config)) {
    const out = await ingest(ingestors[feed], store, options.fetch, now);
    const { entries, stats } = await cleanFeed(out.records, {
      allowlist,
      shared: bundledSharedHosts,
      now,
    });
    feeds[feed] = entries;
    log.feeds[feed] = {
      polled: out.polled,
      not_modified: out.notModified,
      ...(out.error ? { error: out.error } : {}),
      ...stats,
      allowlist_drop_ratio: dropRatio(stats),
    };
  }

  const popupOut = await refreshPopupNetworks(store, options.fetch, now);
  if (popupOut.error)
    console.warn(`[warden-feeds] popup-network refresh failed: ${popupOut.error}`);

  const published = await publish(store, {
    now,
    feeds,
    config,
    allowlistText: allowlistOut.text,
    sharedHosts: bundledSharedHostsFile,
    popupNetworks: popupOut.file ?? bundledPopupNetworksFile,
    includeEvalOnly: options.devFeeds ?? false,
    suppressed: await loadSuppressed(store),
  });
  log.published = published.published;
  log.version = published.manifest.version;

  // Signed every run (not only on publish): the envelope always carries the current config
  // and a fresh signing time.
  if (options.signer === null) {
    log.alerts.push("manifest not signed: MANIFEST_SIGNING_KEY or MANIFEST_KEY_ID is missing");
  } else if (options.signer) {
    try {
      await resignManifest(store, options.signer, () => now);
    } catch (err) {
      log.alerts.push(`manifest not signed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return finish(options, log);
}

async function finish(options: RunOptions, log: QualityLog): Promise<QualityLog> {
  const recorded = await recordQuality(options.store, log);
  for (const alert of recorded.alerts) {
    console.error(`[warden-feeds] ALERT ${alert}`);
    if (options.alertWebhook) {
      await options
        .fetch(options.alertWebhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: `Warden feeds: ${alert}` }),
        })
        .catch((err) => console.error("[warden-feeds] alert webhook failed", err));
    }
  }
  return recorded;
}
