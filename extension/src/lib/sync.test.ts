import "fake-indexeddb/auto";
import { canonicalize } from "@warden/shared/canonicalize";
import { entryExpression, sha256, toHex } from "@warden/shared/expressions";
import {
  type Delta,
  type Manifest,
  type PublishedEntry,
  type Snapshot,
  sha256Hex,
} from "@warden/shared/feed-format";
import { bundledSharedHostsFile } from "@warden/shared/shared-hosts";
import type { FeedId } from "@warden/shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DnrRule } from "./dnr.ts";
import { type ListStore, openListStore } from "./list-store.ts";
import { loadLocalData, readSyncState, syncFeeds } from "./sync.ts";
import { memoryArea } from "./test-utils.ts";

const NOW = 1_000_000;
const BASE = "https://feeds.example";
const ON = { enabled: true, tier: "A" as const };
const FEEDS_CONFIG = {
  openphish: ON,
  phishing_database: { enabled: false, tier: "B" as const },
  phishstats: { enabled: false, tier: "B" as const },
};

async function pub(url: string): Promise<PublishedEntry> {
  const c = canonicalize(url);
  if (!c) throw new Error(url);
  const expression = entryExpression(c);
  return { expression, hash: toHex(await sha256(expression)), expiresAt: NOW + 86_400_000 };
}

/** A tiny fake feed service backed by a map of files. */
class FakeService {
  files = new Map<string, string>();
  manifest: Manifest | null = null;
  fail = false;

  async put(key: string, value: unknown) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    this.files.set(key, text);
    return { key, sha256: await sha256Hex(text) };
  }

  async publishSnapshot(version: number, feeds: Snapshot["feeds"], allowlist = "google.com\n") {
    const snapshot: Snapshot = { schema: 1, version, created: version, feeds };
    this.manifest = {
      schema: 1,
      version,
      created: version,
      snapshot: await this.put(`v1/snapshots/${version}.json`, snapshot),
      deltas: [],
      allowlist: { ...(await this.put("v1/allowlist/a.txt", allowlist)), count: 1 },
      sharedHosts: {
        ...(await this.put("v1/shared-hosts/1.json", bundledSharedHostsFile)),
        version: bundledSharedHostsFile.version,
      },
      feeds: FEEDS_CONFIG,
    };
  }

  async publishDelta(to: number, feeds: Delta["feeds"]) {
    const m = this.manifest as Manifest;
    const delta: Delta = { schema: 1, from: m.version, to, feeds };
    const ref = await this.put(`v1/deltas/${m.version}-${to}.json`, delta);
    this.manifest = { ...m, version: to, deltas: [...m.deltas, { ...ref, from: m.version, to }] };
  }

  fetch = vi.fn(async (input: string | URL | Request) => {
    if (this.fail) throw new TypeError("network down");
    const key = String(input).slice(BASE.length + 1);
    if (key === "v1/manifest.json" && this.manifest)
      return new Response(JSON.stringify(this.manifest));
    const body = this.files.get(key);
    return body === undefined ? new Response("", { status: 404 }) : new Response(body);
  });
}

function fakeDnr() {
  let rules: DnrRule[] = [];
  return {
    get rules() {
      return rules;
    },
    getDynamicRules: vi.fn(async () => rules),
    updateDynamicRules: vi.fn(
      async ({ addRules }: { removeRuleIds: number[]; addRules: DnrRule[] }) => {
        rules = addRules;
      },
    ),
  };
}

let lists: ListStore;
let n = 0;
beforeEach(async () => {
  lists = await openListStore(`sync-${n++}`);
});
afterEach(() => lists.close());

function setup(service: FakeService) {
  const storage = memoryArea();
  const dnr = fakeDnr();
  const deps = {
    baseUrl: BASE,
    fetch: service.fetch as unknown as typeof fetch,
    lists,
    storage,
    dnr,
    bundledShared: bundledSharedHostsFile,
    now: () => NOW,
  };
  return { deps, storage, dnr };
}

const matches = async (url: string) => {
  const { shared } = await loadLocalData(memoryArea(), bundledSharedHostsFile);
  return lists.match(
    canonicalize(url) as NonNullable<ReturnType<typeof canonicalize>>,
    shared,
    NOW,
  );
};

describe("syncFeeds", () => {
  it("loads the snapshot, allowlist, shared hosts, config, and DNR rules on first sync", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://evil.example/")] });
    const { deps, storage, dnr } = setup(service);

    const report = await syncFeeds(deps);
    expect(report).toMatchObject({
      version: 100,
      applied: "snapshot",
      allowlistUpdated: true,
      sharedHostsUpdated: true,
      dnrRules: 1,
    });
    expect(report.error).toBeUndefined();
    expect(await matches("https://evil.example/x")).toHaveLength(1);
    expect(dnr.rules.map((r) => r.condition.urlFilter)).toEqual(["||evil.example/"]);

    const local = await loadLocalData(storage, bundledSharedHostsFile);
    expect(local.allowlist?.allows("mail.google.com")).toBe(true);
  });

  it("applies the delta chain on later syncs", async () => {
    const service = new FakeService();
    const a = await pub("https://a.example/");
    const b = await pub("https://b.example/");
    await service.publishSnapshot(100, { openphish: [a] });
    const { deps } = setup(service);
    await syncFeeds(deps);

    await service.publishDelta(200, { openphish: { added: [b], removed: [a.hash] } });
    const report = await syncFeeds(deps);
    expect(report).toMatchObject({
      version: 200,
      applied: "deltas",
      deltas: 1,
      allowlistUpdated: false,
    });
    expect(await matches("https://a.example/")).toEqual([]);
    expect(await matches("https://b.example/")).toHaveLength(1);
  });

  it("does nothing to the lists when already current", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://a.example/")] });
    const { deps } = setup(service);
    await syncFeeds(deps);
    expect((await syncFeeds(deps)).applied).toBe("none");
  });

  it("falls back to the snapshot when the client is too far behind", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://a.example/")] });
    const { deps } = setup(service);
    await syncFeeds(deps);
    await service.publishSnapshot(500, { openphish: [await pub("https://c.example/")] });
    expect((await syncFeeds(deps)).applied).toBe("snapshot");
    expect(await matches("https://a.example/")).toEqual([]);
    expect(await matches("https://c.example/")).toHaveLength(1);
  });

  it("rejects a file whose checksum doesn't match and keeps the last good data", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://a.example/")] });
    const { deps, storage } = setup(service);
    await syncFeeds(deps);

    await service.publishDelta(200, {
      openphish: { added: [await pub("https://b.example/")], removed: [] },
    });
    service.files.set("v1/deltas/100-200.json", '{"tampered":true}');
    const report = await syncFeeds(deps);
    expect(report.error).toContain("checksum mismatch");
    expect((await readSyncState(storage)).version).toBe(100);
    expect(await matches("https://a.example/")).toHaveLength(1);
    expect(await matches("https://b.example/")).toEqual([]);
  });

  it("keeps everything when the service is unreachable", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://a.example/")] });
    const { deps, storage, dnr } = setup(service);
    await syncFeeds(deps);

    service.fail = true;
    const report = await syncFeeds(deps);
    expect(report.error).toContain("network down");
    expect((await readSyncState(storage)).lastError).toContain("network down");
    expect(await matches("https://a.example/")).toHaveLength(1);
    expect(dnr.rules).toHaveLength(1);
  });

  it("applies the kill switch from the manifest", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://a.example/")] });
    const { deps, dnr } = setup(service);
    await syncFeeds(deps);

    service.manifest = {
      ...(service.manifest as Manifest),
      feeds: { ...FEEDS_CONFIG, openphish: { enabled: false, tier: "A" } },
    };
    await syncFeeds(deps);
    expect(await matches("https://a.example/")).toEqual([]);
    expect(dnr.rules).toEqual([]);
  });

  it("keeps allowlisted and user-trusted hosts out of DNR rules", async () => {
    const service = new FakeService();
    await service.publishSnapshot(
      100,
      {
        openphish: [
          await pub("https://sites.example/"),
          await pub("https://mybank.example/"),
          await pub("https://evil.example/"),
        ],
      },
      "sites.example\n",
    );
    const { deps, dnr } = setup(service);
    await syncFeeds({ ...deps, userTrusted: () => new Set(["mybank.example"]) });
    expect(dnr.rules.map((r) => r.condition.urlFilter)).toEqual(["||evil.example/"]);
  });

  it("only compiles enabled Tier A feeds into DNR rules", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, {
      openphish: [await pub("https://a.example/")],
      phishing_database: [await pub("https://b.example/")],
    });
    service.manifest = {
      ...(service.manifest as Manifest),
      feeds: { ...FEEDS_CONFIG, phishing_database: { enabled: true, tier: "B" } },
    };
    const { deps, dnr } = setup(service);
    await syncFeeds(deps);
    expect(dnr.rules.map((r) => r.condition.urlFilter)).toEqual(["||a.example/"]);
    const tierB = await matches("https://b.example/");
    expect(tierB.map((m) => `${m.feed as FeedId}:${m.tier}`)).toEqual(["phishing_database:B"]);
  });
});
