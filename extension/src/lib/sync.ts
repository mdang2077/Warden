/**
 * Feed sync (runs on install, on browser start, and every 60 min via chrome.alarms):
 *
 *  1. Fetch the manifest. Apply its feed config right away (kill switch).
 *  2. Bring the local lists to the manifest version: the delta chain when there is one
 *     from our version, otherwise the full snapshot.
 *  3. Refresh the allowlist and shared-host list when their checksums changed.
 *  4. Rebuild the Tier A DNR block rules.
 *
 * Every file is checked against the manifest's SHA-256 before it is used. Any failure
 * stops the sync and keeps the last good data: a broken or unreachable service can make
 * Warden block less, never more.
 */
import { type Allowlist, parseAllowlist } from "@warden/shared/allowlist";
import {
  type Delta,
  deltaChain,
  type FileRef,
  FORMAT_SCHEMA,
  type Manifest,
  type Snapshot,
  sha256Hex,
} from "@warden/shared/feed-format";
import {
  loadSharedHosts,
  type SharedHostList,
  type SharedHostsFile,
} from "@warden/shared/shared-hosts";
import { FEED_IDS } from "@warden/shared/types";
import { compileDnrRules, type DnrApi, type DnrEntry, replaceDynamicRules } from "./dnr.ts";
import type { ListStore } from "./list-store.ts";
import type { KeyValueArea } from "./overrides.ts";

export const SYNC_PERIOD_MINUTES = 60;
const FETCH_TIMEOUT_MS = 30_000;

const STATE_KEY = "sync_state";
const ALLOWLIST_KEY = "allowlist_text";
const SHARED_HOSTS_KEY = "shared_hosts_file";

export interface SyncState {
  version: number | null;
  allowlistSha: string | null;
  sharedHostsSha: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface SyncReport {
  version: number | null;
  applied: "none" | "deltas" | "snapshot";
  deltas: number;
  allowlistUpdated: boolean;
  sharedHostsUpdated: boolean;
  dnrRules: number;
  dnrSkipped: number;
  error?: string;
}

/** What the cascade stages read; swapped in place after each sync. */
export interface LocalData {
  allowlist: Allowlist | null;
  shared: SharedHostList;
}

export interface SyncDeps {
  baseUrl: string;
  fetch: typeof fetch;
  lists: Pick<
    ListStore,
    "setFeedConfig" | "replaceFeed" | "applyDelta" | "pruneExpired" | "entries"
  >;
  storage: KeyValueArea;
  dnr: DnrApi;
  bundledShared: SharedHostsFile;
  now?: () => number;
}

const EMPTY_STATE: SyncState = {
  version: null,
  allowlistSha: null,
  sharedHostsSha: null,
  lastSyncAt: null,
  lastError: null,
};

async function read<T>(storage: KeyValueArea, key: string): Promise<T | null> {
  return ((await storage.get(key))[key] as T | undefined) ?? null;
}

/**
 * The allowlist and shared-host list from the last good sync. A synced shared-host list
 * only replaces the bundled one when its version is at least as new.
 */
export async function loadLocalData(
  storage: KeyValueArea,
  bundledShared: SharedHostsFile,
): Promise<LocalData> {
  let sharedFile = bundledShared;
  const synced = await read<SharedHostsFile>(storage, SHARED_HOSTS_KEY);
  if (synced && synced.version >= bundledShared.version) sharedFile = synced;
  let shared: SharedHostList;
  try {
    shared = loadSharedHosts(sharedFile);
  } catch {
    shared = loadSharedHosts(bundledShared);
  }
  const text = await read<string>(storage, ALLOWLIST_KEY);
  return { allowlist: text ? parseAllowlist(text, shared) : null, shared };
}

export async function readSyncState(storage: KeyValueArea): Promise<SyncState> {
  return { ...EMPTY_STATE, ...(await read<SyncState>(storage, STATE_KEY)) };
}

export async function syncFeeds(deps: SyncDeps): Promise<SyncReport> {
  const now = deps.now ?? Date.now;
  const state = await readSyncState(deps.storage);
  const report: SyncReport = {
    version: state.version,
    applied: "none",
    deltas: 0,
    allowlistUpdated: false,
    sharedHostsUpdated: false,
    dnrRules: 0,
    dnrSkipped: 0,
  };

  const fetchText = async (path: string): Promise<string> => {
    const res = await deps.fetch(`${deps.baseUrl.replace(/\/+$/, "")}/${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.text();
  };
  const fetchVerified = async (ref: FileRef): Promise<string> => {
    const text = await fetchText(ref.key);
    if ((await sha256Hex(text)) !== ref.sha256) throw new Error(`${ref.key}: checksum mismatch`);
    return text;
  };

  try {
    const manifest = JSON.parse(await fetchText("v1/manifest.json")) as Manifest;
    if (manifest.schema !== FORMAT_SCHEMA) throw new Error(`unsupported schema ${manifest.schema}`);

    // Kill switch first: a disabled feed stops matching even if the rest of the sync fails.
    for (const feed of FEED_IDS) {
      const settings = manifest.feeds?.[feed];
      await deps.lists.setFeedConfig(feed, settings ?? { enabled: false, tier: "B" });
    }

    if (manifest.version !== state.version) {
      const chain = state.version === null ? null : deltaChain(manifest, state.version);
      if (chain) {
        for (const ref of chain) {
          const delta = JSON.parse(await fetchVerified(ref)) as Delta;
          for (const feed of FEED_IDS) {
            const d = delta.feeds[feed];
            if (d) await deps.lists.applyDelta(feed, d.added, d.removed);
          }
          state.version = delta.to;
          await deps.storage.set({ [STATE_KEY]: state });
          report.deltas++;
        }
        report.applied = "deltas";
      } else {
        const snapshot = JSON.parse(await fetchVerified(manifest.snapshot)) as Snapshot;
        for (const feed of FEED_IDS) await deps.lists.replaceFeed(feed, snapshot.feeds[feed] ?? []);
        state.version = snapshot.version;
        await deps.storage.set({ [STATE_KEY]: state });
        report.applied = "snapshot";
      }
      report.version = state.version;
    }

    if (manifest.sharedHosts.sha256 !== state.sharedHostsSha) {
      const file = JSON.parse(await fetchVerified(manifest.sharedHosts)) as SharedHostsFile;
      loadSharedHosts(file); // throws on a malformed list, before it's stored
      await deps.storage.set({ [SHARED_HOSTS_KEY]: file });
      state.sharedHostsSha = manifest.sharedHosts.sha256;
      report.sharedHostsUpdated = true;
    }

    if (manifest.allowlist.sha256 !== state.allowlistSha) {
      const text = await fetchVerified(manifest.allowlist);
      await deps.storage.set({ [ALLOWLIST_KEY]: text });
      state.allowlistSha = manifest.allowlist.sha256;
      report.allowlistUpdated = true;
    }

    await deps.lists.pruneExpired(now());

    const { shared } = await loadLocalData(deps.storage, deps.bundledShared);
    const tierA: DnrEntry[] = [];
    for (const feed of FEED_IDS) {
      const settings = manifest.feeds?.[feed];
      if (!settings?.enabled || settings.tier !== "A") continue;
      for (const e of await deps.lists.entries(feed, now())) {
        if (e.expression) tierA.push({ expression: e.expression, feed });
      }
    }
    const { rules, skipped } = compileDnrRules(tierA, shared);
    await replaceDynamicRules(deps.dnr, rules);
    report.dnrRules = rules.length;
    report.dnrSkipped = skipped;

    state.lastError = null;
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    state.lastError = report.error;
  }

  state.lastSyncAt = now();
  await deps.storage.set({ [STATE_KEY]: state });
  return report;
}
