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
import { bundledPopupNetworksFile, type PopupNetworksFile } from "@warden/shared/popup-networks";
import { bundledSharedHostsFile } from "@warden/shared/shared-hosts";
import {
  generateManifestKeyPair,
  importPrivateKey,
  importPublicKeys,
  type SignedManifest,
  signManifest,
} from "@warden/shared/signed-manifest";
import type { FeedId } from "@warden/shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DnrRule } from "./dnr.ts";
import { type ListStore, openListStore } from "./list-store.ts";
import { loadLocalData, readSyncState, syncFeeds } from "./sync.ts";
import { memoryArea } from "./test-utils.ts";

const TEST_PAIR = await generateManifestKeyPair();
const TEST_KEYS = await importPublicKeys({ keys: [{ kid: "t1", publicKey: TEST_PAIR.publicKey }] });
const TEST_SIGNING_KEY = await importPrivateKey(TEST_PAIR.privateKey);

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
  /** Serve the manifest unsigned (the pre-signing format). */
  unsigned = false;
  /** Edit the signed envelope before serving it (tampering). */
  tamper: ((env: SignedManifest) => SignedManifest) | null = null;
  /** The signing time the service stamps into the manifest. */
  signedAt = NOW;

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

  async publishPopupNetworks(file: PopupNetworksFile, corrupt = false) {
    const m = this.manifest as Manifest;
    const ref = await this.put(`v1/popup-networks/${file.version}.json`, file);
    if (corrupt) this.files.set(ref.key, "{}");
    this.manifest = { ...m, popupNetworks: { ...ref, version: file.version } };
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
    if (key === "v1/manifest.json" && this.manifest) {
      if (this.unsigned) return new Response(JSON.stringify(this.manifest));
      const env = await signManifest(this.manifest, TEST_SIGNING_KEY, "t1", this.signedAt);
      return new Response(JSON.stringify(this.tamper ? this.tamper(env) : env));
    }
    const body = this.files.get(key);
    return body === undefined ? new Response("", { status: 404 }) : new Response(body);
  });
}

function fakeDnr(initial: DnrRule[] = []) {
  let rules: DnrRule[] = initial;
  return {
    get rules() {
      return rules;
    },
    getDynamicRules: vi.fn(async () => rules),
    updateDynamicRules: vi.fn(
      async ({ removeRuleIds, addRules }: { removeRuleIds: number[]; addRules: DnrRule[] }) => {
        rules = [...rules.filter((r) => !removeRuleIds.includes(r.id)), ...addRules];
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
    manifestKeys: async () => TEST_KEYS,
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

  it("applies the kill switch to DNR rules even when the rest of the sync fails", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://a.example/")] });
    const { deps, dnr } = setup(service);
    await syncFeeds(deps);
    expect(dnr.rules).toHaveLength(1);

    await service.publishDelta(200, {
      openphish: { added: [await pub("https://b.example/")], removed: [] },
    });
    service.files.set("v1/deltas/100-200.json", '{"tampered":true}');
    service.manifest = {
      ...(service.manifest as Manifest),
      feeds: { ...FEEDS_CONFIG, openphish: { enabled: false, tier: "A" } },
    };
    const report = await syncFeeds(deps);
    expect(report.error).toContain("checksum mismatch");
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

describe("popup-network list sync", () => {
  const synced: PopupNetworksFile = {
    version: 5,
    generatedAt: "",
    sources: [],
    domains: ["popnet.example"],
  };

  it("downloads, verifies, and serves the list", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, {});
    await service.publishPopupNetworks(synced);
    const { deps, storage } = setup(service);
    const report = await syncFeeds(deps);
    expect(report.popupNetworksUpdated).toBe(true);
    const local = await loadLocalData(storage, bundledSharedHostsFile);
    expect(local.popupNetworks.has("go.popnet.example")).toBe(true);
    expect((await syncFeeds(deps)).popupNetworksUpdated).toBe(false);
  });

  it("keeps the bundled list on a checksum mismatch or an old manifest", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, {});
    const { deps, storage } = setup(service);
    await syncFeeds(deps); // manifest without popupNetworks
    let local = await loadLocalData(storage, bundledSharedHostsFile);
    expect(local.popupNetworks.domains).toEqual([...bundledPopupNetworksFile.domains].sort());

    await service.publishPopupNetworks(synced, true);
    const report = await syncFeeds(deps);
    expect(report.error).toMatch(/checksum/);
    local = await loadLocalData(storage, bundledSharedHostsFile);
    expect(local.popupNetworks.has("popnet.example")).toBe(false);
  });

  it("installs no phishing rules while phishing protection is off, leaving hijack rules", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://evil.example/")] });
    const { deps, dnr } = setup(service);
    const hijackRule = { id: 29_900 } as unknown as DnrRule;
    await dnr.updateDynamicRules({ removeRuleIds: [], addRules: [hijackRule] });
    const report = await syncFeeds({ ...deps, phishingEnabled: () => false });
    expect(report.dnrRules).toBe(0);
    expect(dnr.rules.map((r) => r.id)).toEqual([29_900]);
  });
});

describe("syncFeeds: manifest signature", () => {
  it("rejects a tampered manifest and applies nothing, not even the kill switch", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://evil.example/")] });
    const { deps, storage, dnr } = setup(service);
    await syncFeeds(deps);
    const before = await readSyncState(storage);
    const rulesBefore = dnr.rules;

    await service.publishSnapshot(200, {});
    service.tamper = (env) => ({
      ...env,
      payload: env.payload.replace('"enabled":true', '"enabled":false'),
    });
    const setFeedConfig = vi.spyOn(lists, "setFeedConfig");
    dnr.updateDynamicRules.mockClear();
    const report = await syncFeeds(deps);
    expect(report.error).toMatch(/manifest signature invalid: bad signature/);
    expect(setFeedConfig).not.toHaveBeenCalled();
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.rules).toEqual(rulesBefore);
    const { lastError, ...after } = await readSyncState(storage);
    const { lastError: _, ...unchanged } = before;
    expect(after).toEqual(unchanged); // only the error is recorded
    expect(lastError).toMatch(/manifest signature invalid/);
    expect(await matches("https://evil.example/")).not.toEqual([]); // last good data kept
  });

  it("rejects an unsigned manifest and an unknown key on first sync", async () => {
    for (const [configure, why] of [
      [(s: FakeService) => (s.unsigned = true), "malformed"],
      [(s: FakeService) => (s.tamper = (env) => ({ ...env, kid: "zz" })), "unknown key"],
    ] as const) {
      const service = new FakeService();
      await service.publishSnapshot(100, { openphish: [await pub("https://evil.example/")] });
      configure(service);
      const { deps, storage, dnr } = setup(service);
      const report = await syncFeeds(deps);
      expect(report.error).toContain(`manifest signature invalid: ${why}`);
      expect(dnr.rules).toEqual([]);
      expect((await readSyncState(storage)).version).toBeNull();
    }
  });
});

describe("syncFeeds: replay and rollback", () => {
  async function accepted() {
    const service = new FakeService();
    await service.publishSnapshot(100, { openphish: [await pub("https://evil.example/")] });
    service.signedAt = 1_000;
    const old = await signManifest(service.manifest as Manifest, TEST_SIGNING_KEY, "t1", 1_000);
    await service.publishSnapshot(200, {});
    service.signedAt = 2_000;
    const { deps, storage, dnr } = setup(service);
    expect((await syncFeeds(deps)).error).toBeUndefined();
    return { service, deps, storage, dnr, old };
  }

  it("rejects an older signed manifest replayed after a newer one", async () => {
    const { service, deps, storage, old } = await accepted();
    service.tamper = () => old;
    const setFeedConfig = vi.spyOn(lists, "setFeedConfig");
    const report = await syncFeeds(deps);
    expect(report.error).toMatch(/older than the last one accepted/);
    expect(setFeedConfig).not.toHaveBeenCalled();
    expect((await readSyncState(storage)).version).toBe(200);
  });

  it("rejects a newer signature over an older version (rollback)", async () => {
    const { service, deps, storage } = await accepted();
    service.manifest = { ...(service.manifest as Manifest), version: 100 };
    service.signedAt = 3_000;
    expect((await syncFeeds(deps)).error).toMatch(/rolled back/);
    expect((await readSyncState(storage)).version).toBe(200);
  });

  it("accepts the same manifest served again (a CDN cache)", async () => {
    const { deps } = await accepted();
    expect((await syncFeeds(deps)).error).toBeUndefined();
  });

  it("rejects a signed manifest without a signing time", async () => {
    const service = new FakeService();
    await service.publishSnapshot(100, {});
    const bare = await signManifest(service.manifest as Manifest, TEST_SIGNING_KEY, "t1");
    const { signedAt: _, ...rest } = JSON.parse(bare.payload);
    const payloadOnly = JSON.stringify(rest);
    const sig = await crypto.subtle.sign(
      "Ed25519",
      TEST_SIGNING_KEY,
      new TextEncoder().encode(payloadOnly),
    );
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    service.tamper = () => ({ ...bare, payload: payloadOnly, sig: b64 });
    const { deps } = setup(service);
    expect((await syncFeeds(deps)).error).toMatch(/no signing time/);
  });
});
