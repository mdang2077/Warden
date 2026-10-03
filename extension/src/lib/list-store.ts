/**
 * Local blocklist store in IndexedDB. Each feed's entries are full SHA-256 hashes of their
 * canonical expression (never the URLs themselves), with a per-entry expiry. A feed's
 * tier and enabled flag live in a separate record so remote config can re-tier or
 * disable a feed without rewriting its entries.
 */
import type { CanonicalUrl } from "@warden/shared/canonicalize";
import { hashExpressions } from "@warden/shared/expressions";
import { protectedLookupExpressions, type SharedHostList } from "@warden/shared/shared-hosts";
import type { FeedId, FeedTier } from "@warden/shared/types";

export interface ListEntry {
  /** Full SHA-256 of the entry's canonical expression, hex. */
  hash: string;
  /** Milliseconds since epoch. Entries past this are ignored and pruned. */
  expiresAt: number;
}

export interface FeedConfig {
  tier: FeedTier;
  enabled: boolean;
}

export interface ListMatch {
  feed: FeedId;
  tier: FeedTier;
  /** The lookup expression that matched. */
  expression: string;
}

interface EntryRecord extends ListEntry {
  feed: FeedId;
}

const DB_VERSION = 1;
const ENTRIES = "entries";
const FEEDS = "feeds";

export async function openListStore(name = "warden-lists", factory: IDBFactory = indexedDB) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const entries = req.result.createObjectStore(ENTRIES, { keyPath: ["feed", "hash"] });
      entries.createIndex("hash", "hash");
      entries.createIndex("feed", "feed");
      req.result.createObjectStore(FEEDS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return createListStore(db);
}

function createListStore(db: IDBDatabase) {
  function tx(stores: string[], mode: IDBTransactionMode) {
    const t = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error("transaction aborted"));
    });
    return { t, done };
  }

  function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function deleteFeedEntries(store: IDBObjectStore, feed: FeedId) {
    store.delete(IDBKeyRange.bound([feed, ""], [feed, "￿"]));
  }

  return {
    async setFeedConfig(feed: FeedId, config: FeedConfig): Promise<void> {
      const { t, done } = tx([FEEDS], "readwrite");
      t.objectStore(FEEDS).put(config, feed);
      await done;
    },

    async feedConfigs(): Promise<Map<FeedId, FeedConfig>> {
      const { t, done } = tx([FEEDS], "readonly");
      const store = t.objectStore(FEEDS);
      const [keys, values] = await Promise.all([
        request(store.getAllKeys()),
        request(store.getAll()),
      ]);
      await done;
      return new Map(keys.map((k, i) => [k as FeedId, values[i] as FeedConfig]));
    },

    /** Replaces all of a feed's entries in one transaction (full snapshot). */
    async replaceFeed(feed: FeedId, entries: readonly ListEntry[]): Promise<void> {
      const { t, done } = tx([ENTRIES], "readwrite");
      const store = t.objectStore(ENTRIES);
      deleteFeedEntries(store, feed);
      for (const e of entries) store.put({ feed, hash: e.hash, expiresAt: e.expiresAt });
      await done;
    },

    /** Applies a delta in one transaction: removals first, then additions (upserts). */
    async applyDelta(
      feed: FeedId,
      added: readonly ListEntry[],
      removedHashes: readonly string[],
    ): Promise<void> {
      const { t, done } = tx([ENTRIES], "readwrite");
      const store = t.objectStore(ENTRIES);
      for (const hash of removedHashes) store.delete([feed, hash]);
      for (const e of added) store.put({ feed, hash: e.hash, expiresAt: e.expiresAt });
      await done;
    },

    /** Deletes expired entries. Returns how many were removed. */
    async pruneExpired(now: number): Promise<number> {
      const { t, done } = tx([ENTRIES], "readwrite");
      const store = t.objectStore(ENTRIES);
      let removed = 0;
      await new Promise<void>((resolve, reject) => {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return resolve();
          if ((cursor.value as EntryRecord).expiresAt <= now) {
            cursor.delete();
            removed++;
          }
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      await done;
      return removed;
    },

    async count(feed: FeedId): Promise<number> {
      const { t, done } = tx([ENTRIES], "readonly");
      const n = await request(t.objectStore(ENTRIES).index("feed").count(feed));
      await done;
      return n;
    },

    /**
     * Feed hits for a canonical URL, with shared-host protection applied. Disabled feeds,
     * feeds with no config, and expired entries never match.
     */
    async match(url: CanonicalUrl, shared: SharedHostList, now: number): Promise<ListMatch[]> {
      const hashed = await hashExpressions(protectedLookupExpressions(url, shared));
      const configs = await this.feedConfigs();

      const { t, done } = tx([ENTRIES], "readonly");
      const index = t.objectStore(ENTRIES).index("hash");
      const results = await Promise.all(
        hashed.map(async (h) => ({
          expression: h.expression,
          records: (await request(index.getAll(h.hash))) as EntryRecord[],
        })),
      );
      await done;

      const matches: ListMatch[] = [];
      for (const { expression, records } of results) {
        for (const r of records) {
          const config = configs.get(r.feed);
          if (!config?.enabled || r.expiresAt <= now) continue;
          matches.push({ feed: r.feed, tier: config.tier, expression });
        }
      }
      return matches;
    },

    close() {
      db.close();
    },
  };
}

export type ListStore = Awaited<ReturnType<typeof openListStore>>;
