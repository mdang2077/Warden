import {
  type Delta,
  deltaChain,
  type Manifest,
  type Snapshot,
  sha256Hex,
} from "@warden/shared/feed-format";
import { bundledPopupNetworksFile } from "@warden/shared/popup-networks";
import { bundledSharedHostsFile as sharedHostsFile } from "@warden/shared/shared-hosts";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_CONFIG, type FeedConfig } from "./config.ts";
import type { CleanEntry } from "./pipeline.ts";
import { MANIFEST_KEY, MAX_DELTAS, publish } from "./publish.ts";
import { getJson, memoryStore } from "./storage.ts";

function entry(hash: string, expiresAt = 1000): CleanEntry {
  return { expression: `${hash}.example/`, hash, first_seen: 0, last_seen: 0, expiresAt };
}

function input(now: number, openphish: CleanEntry[], config: FeedConfig = DEFAULT_FEED_CONFIG) {
  return {
    now,
    feeds: { openphish, phishing_database: [entry("bb")] },
    config,
    allowlistText: "google.com\n",
    sharedHosts: sharedHostsFile,
    popupNetworks: bundledPopupNetworksFile,
    // These tests exercise publishing mechanics with OpenPhish data, as a dev run would.
    includeEvalOnly: true,
  };
}

describe("publish", () => {
  it("publishes the popup-network list and republishes when only it changes", async () => {
    const store = memoryStore();
    const first = await publish(store, input(100, [entry("aa")]));
    const ref = first.manifest.popupNetworks;
    if (!ref) throw new Error("no popupNetworks in manifest");
    const text = await store.get(ref.key);
    expect(text).not.toBeNull();
    expect(await sha256Hex(text as string)).toBe(ref.sha256);
    expect(ref.version).toBe(bundledPopupNetworksFile.version);

    const changed = {
      ...input(200, [entry("aa")]),
      popupNetworks: { ...bundledPopupNetworksFile, version: 2, domains: ["new.example"] },
    };
    const second = await publish(store, changed);
    expect(second.published).toBe(true);
    expect(second.manifest.popupNetworks?.version).toBe(2);
  });

  it("writes a snapshot, allowlist, shared hosts, and a manifest with checksums", async () => {
    const store = memoryStore();
    const { published, manifest } = await publish(store, input(100, [entry("aa")]));
    expect(published).toBe(true);
    expect(manifest.version).toBe(100);
    expect(manifest.deltas).toEqual([]);
    expect(manifest.allowlist.count).toBe(1);

    for (const ref of [manifest.snapshot, manifest.allowlist, manifest.sharedHosts]) {
      const text = await store.get(ref.key);
      expect(text).not.toBeNull();
      expect(await sha256Hex(text as string)).toBe(ref.sha256);
    }
    expect(await getJson(store, MANIFEST_KEY)).toEqual(manifest);
  });

  it("only publishes enabled feeds", async () => {
    const store = memoryStore();
    const { manifest } = await publish(store, input(100, [entry("aa")]));
    const snap = await getJson<Snapshot>(store, manifest.snapshot.key);
    expect(Object.keys(snap?.feeds ?? {})).toEqual(["openphish"]);
  });

  it("does nothing when nothing changed", async () => {
    const store = memoryStore();
    await publish(store, input(100, [entry("aa")]));
    const again = await publish(store, input(200, [entry("aa")]));
    expect(again.published).toBe(false);
    expect(again.manifest.version).toBe(100);
  });

  it("writes a delta with additions, expiry updates, and removals", async () => {
    const store = memoryStore();
    await publish(store, input(100, [entry("aa"), entry("cc")]));
    const { manifest } = await publish(store, input(200, [entry("aa", 2000), entry("dd")]));
    expect(manifest.deltas.map((d) => [d.from, d.to])).toEqual([[100, 200]]);
    const ref = manifest.deltas[0] as Manifest["deltas"][number];
    const text = (await store.get(ref.key)) as string;
    expect(await sha256Hex(text)).toBe(ref.sha256);
    const delta = JSON.parse(text) as Delta;
    expect(delta.feeds.openphish?.added.map((e) => e.hash)).toEqual(["aa", "dd"]);
    expect(delta.feeds.openphish?.removed).toEqual(["cc"]);
  });

  it("removes a disabled feed's entries via the delta (kill switch)", async () => {
    const store = memoryStore();
    await publish(store, input(100, [entry("aa")]));
    const off = { ...DEFAULT_FEED_CONFIG, openphish: { enabled: false, tier: "A" as const } };
    const { manifest } = await publish(store, input(200, [entry("aa")], off));
    const delta = await getJson<Delta>(store, manifest.deltas[0]?.key as string);
    expect(delta?.feeds.openphish).toEqual({ added: [], removed: ["aa"] });
  });

  it("keeps versions increasing even if the clock goes backwards", async () => {
    const store = memoryStore();
    await publish(store, input(100, [entry("aa")]));
    const { manifest } = await publish(store, input(50, [entry("bb")]));
    expect(manifest.version).toBe(101);
  });

  it("keeps a contiguous, capped delta chain and prunes old files", async () => {
    const store = memoryStore();
    for (let i = 1; i <= MAX_DELTAS + 5; i++) {
      await publish(store, input(i * 100, [entry(`h${i}`)]));
    }
    const manifest = (await getJson<Manifest>(store, MANIFEST_KEY)) as Manifest;
    expect(manifest.deltas).toHaveLength(MAX_DELTAS);
    expect(deltaChain(manifest, manifest.deltas[0]?.from as number)).toHaveLength(MAX_DELTAS);
    expect(await store.list("v1/deltas/")).toHaveLength(MAX_DELTAS);
    expect((await store.list("v1/snapshots/")).length).toBeLessThanOrEqual(3);
  });
});

describe("publish: feed distribution (T4b.2)", () => {
  const both: FeedConfig = {
    ...DEFAULT_FEED_CONFIG,
    openphish: { enabled: true, tier: "A" },
    phishing_database: { enabled: true, tier: "B" },
  };

  it("leaves eval-only feeds out of a production snapshot, even when enabled", async () => {
    const store = memoryStore();
    const { includeEvalOnly: _, ...prod } = input(100, [entry("aa")], both);
    const out = await publish(store, prod);
    const snapshot = await getJson<Snapshot>(store, out.manifest.snapshot.key);
    expect(snapshot?.feeds.openphish).toBeUndefined();
    expect(snapshot?.feeds.phishing_database?.map((e) => e.hash)).toEqual(["bb"]);
    expect([...store.data.values()].some((v) => v.includes('"aa"'))).toBe(false);
  });

  it("includes them only when asked to (dev feeds)", async () => {
    const store = memoryStore();
    const out = await publish(store, { ...input(100, [entry("aa")], both), includeEvalOnly: true });
    const snapshot = await getJson<Snapshot>(store, out.manifest.snapshot.key);
    expect(snapshot?.feeds.openphish?.map((e) => e.hash)).toEqual(["aa"]);
  });
});

describe("publish: suppressed entries (wrong-block reports)", () => {
  it("leaves suppressed entry hashes out of the snapshot, and the delta removes them", async () => {
    const store = memoryStore();
    await publish(store, input(100, [entry("aa"), entry("ab")]));
    const out = await publish(store, {
      ...input(200, [entry("aa"), entry("ab")]),
      suppressed: ["aa"],
    });
    const snapshot = await getJson<Snapshot>(store, out.manifest.snapshot.key);
    expect(snapshot?.feeds.openphish?.map((e) => e.hash)).toEqual(["ab"]);
    const delta = await getJson<Delta>(store, (out.manifest.deltas.at(-1) as { key: string }).key);
    expect(delta?.feeds.openphish?.removed).toEqual(["aa"]);
  });
});
