/**
 * Publishes a versioned snapshot, a delta from the previous snapshot, the allowlist, the
 * shared-host list, the popup-network list, and a manifest that references them all by
 * key + SHA-256. Content
 * files are written first and the manifest last, so a client never sees a manifest that
 * points at files that don't exist yet. Nothing is published when nothing changed.
 */
import {
  type Delta,
  FEED_DISTRIBUTION,
  type FeedDelta,
  FORMAT_SCHEMA,
  type Manifest,
  type PublishedEntry,
  type Snapshot,
  sha256Hex,
} from "@warden/shared/feed-format";
import type { PopupNetworksFile } from "@warden/shared/popup-networks";
import type { SharedHostsFile } from "@warden/shared/shared-hosts";
import { FEED_IDS, type FeedId } from "@warden/shared/types";
import { enabledFeeds, type FeedConfig } from "./config.ts";
import type { CleanEntry } from "./pipeline.ts";
import { type BlobStore, getJson } from "./storage.ts";

export const MANIFEST_KEY = "v1/manifest.json";
/** Hourly runs → two days of deltas. */
export const MAX_DELTAS = 48;
const KEEP_SNAPSHOTS = 3;

export interface PublishInput {
  now: number;
  feeds: Partial<Record<FeedId, CleanEntry[]>>;
  config: FeedConfig;
  allowlistText: string;
  sharedHosts: SharedHostsFile;
  popupNetworks: PopupNetworksFile;
  /** Publish `eval_only` feeds too. Only for a dev run (WARDEN_DEV_FEEDS=1), never in production. */
  includeEvalOnly?: boolean;
  /** Entry hashes pulled after wrong-block reports (suppress.ts); left out of every feed. */
  suppressed?: readonly string[];
}

export interface PublishOutcome {
  published: boolean;
  manifest: Manifest;
}

export async function publish(store: BlobStore, input: PublishInput): Promise<PublishOutcome> {
  const prev = await getJson<Manifest>(store, MANIFEST_KEY);
  const prevSnapshot = prev ? await getJson<Snapshot>(store, prev.snapshot.key) : null;

  const feeds: Snapshot["feeds"] = {};
  const suppressed = new Set(input.suppressed ?? []);
  for (const feed of enabledFeeds(input.config)) {
    if (FEED_DISTRIBUTION[feed] !== "shippable" && !input.includeEvalOnly) continue;
    feeds[feed] = (input.feeds[feed] ?? [])
      .filter((e) => !suppressed.has(e.hash))
      .map(toPublished)
      .sort(byHash);
  }

  const allowlistSha = await sha256Hex(input.allowlistText);
  const sharedText = JSON.stringify(input.sharedHosts);
  const sharedSha = await sha256Hex(sharedText);
  const popupText = JSON.stringify(input.popupNetworks);
  const popupSha = await sha256Hex(popupText);

  const unchanged =
    prev &&
    prevSnapshot &&
    JSON.stringify(prevSnapshot.feeds) === JSON.stringify(feeds) &&
    prev.allowlist.sha256 === allowlistSha &&
    prev.sharedHosts.sha256 === sharedSha &&
    prev.popupNetworks?.sha256 === popupSha;
  if (prev && unchanged) return { published: false, manifest: { ...prev, feeds: input.config } };

  const version = Math.max(input.now, (prev?.version ?? 0) + 1);

  const allowlistKey = `v1/allowlist/${allowlistSha.slice(0, 16)}.txt`;
  if ((await store.get(allowlistKey)) === null) {
    await store.put(allowlistKey, input.allowlistText, "text/plain");
  }
  const sharedKey = `v1/shared-hosts/${input.sharedHosts.version}-${sharedSha.slice(0, 16)}.json`;
  if ((await store.get(sharedKey)) === null) {
    await store.put(sharedKey, sharedText, "application/json");
  }
  const popupKey = `v1/popup-networks/${input.popupNetworks.version}-${popupSha.slice(0, 16)}.json`;
  if ((await store.get(popupKey)) === null) {
    await store.put(popupKey, popupText, "application/json");
  }

  const snapshot: Snapshot = { schema: FORMAT_SCHEMA, version, created: input.now, feeds };
  const snapshotText = JSON.stringify(snapshot);
  const snapshotKey = `v1/snapshots/${version}.json`;
  await store.put(snapshotKey, snapshotText, "application/json");

  let deltas = prev?.deltas ?? [];
  if (prev && prevSnapshot) {
    const delta: Delta = {
      schema: FORMAT_SCHEMA,
      from: prev.version,
      to: version,
      feeds: diffFeeds(prevSnapshot.feeds, feeds),
    };
    const deltaText = JSON.stringify(delta);
    const deltaKey = `v1/deltas/${prev.version}-${version}.json`;
    await store.put(deltaKey, deltaText, "application/json");
    deltas = [
      ...deltas,
      { key: deltaKey, sha256: await sha256Hex(deltaText), from: prev.version, to: version },
    ].slice(-MAX_DELTAS);
  }

  const manifest: Manifest = {
    schema: FORMAT_SCHEMA,
    version,
    created: input.now,
    snapshot: { key: snapshotKey, sha256: await sha256Hex(snapshotText) },
    deltas,
    allowlist: {
      key: allowlistKey,
      sha256: allowlistSha,
      count: input.allowlistText.split("\n").filter(Boolean).length,
    },
    sharedHosts: { key: sharedKey, sha256: sharedSha, version: input.sharedHosts.version },
    popupNetworks: { key: popupKey, sha256: popupSha, version: input.popupNetworks.version },
    feeds: input.config,
  };
  await store.put(MANIFEST_KEY, JSON.stringify(manifest), "application/json");
  await prune(store, manifest);
  return { published: true, manifest };
}

function toPublished(e: CleanEntry): PublishedEntry {
  return { hash: e.hash, expression: e.expression, expiresAt: e.expiresAt };
}

function byHash(a: PublishedEntry, b: PublishedEntry): number {
  return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
}

export function diffFeeds(prev: Snapshot["feeds"], next: Snapshot["feeds"]): Delta["feeds"] {
  const out: Delta["feeds"] = {};
  for (const feed of FEED_IDS) {
    const before = new Map((prev[feed] ?? []).map((e) => [e.hash, e]));
    const after = next[feed] ?? [];
    const afterHashes = new Set(after.map((e) => e.hash));
    const delta: FeedDelta = {
      added: after.filter((e) => before.get(e.hash)?.expiresAt !== e.expiresAt),
      removed: [...before.keys()].filter((h) => !afterHashes.has(h)),
    };
    if (delta.added.length || delta.removed.length) out[feed] = delta;
  }
  return out;
}

/** Drops deltas the manifest no longer lists and all but the newest few snapshots. */
async function prune(store: BlobStore, manifest: Manifest): Promise<void> {
  const liveDeltas = new Set(manifest.deltas.map((d) => d.key));
  for (const key of await store.list("v1/deltas/")) {
    if (!liveDeltas.has(key)) await store.delete(key);
  }
  const snapshots = (await store.list("v1/snapshots/")).sort((a, b) => versionOf(b) - versionOf(a));
  for (const key of snapshots.slice(KEEP_SNAPSHOTS)) {
    if (key !== manifest.snapshot.key) await store.delete(key);
  }
}

function versionOf(key: string): number {
  return Number(/(\d+)\.json$/.exec(key)?.[1] ?? 0);
}
