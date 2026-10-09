import {
  generateManifestKeyPair,
  importPublicKeys,
  verifyManifest,
} from "@warden/shared/signed-manifest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type AppDeps, handleRequest } from "./app.ts";
import { CONFIG_KEY, DEFAULT_FEED_CONFIG } from "./config.ts";
import { MANIFEST_KEY } from "./publish.ts";
import { createSigner, resignManifest, SIGNED_MANIFEST_KEY } from "./signing.ts";
import { memoryStore } from "./storage.ts";

let pair: { publicKey: string; privateKey: string };
beforeAll(async () => {
  pair = await generateManifestKeyPair();
});

function deps(
  overrides: Partial<AppDeps> = {},
): AppDeps & { store: ReturnType<typeof memoryStore> } {
  return {
    store: memoryStore(),
    fetch: vi.fn() as unknown as typeof fetch,
    sbApiKey: "KEY",
    sbLimiter: undefined,
    adminToken: "secret",
    signer: createSigner(pair.privateKey, "t1"),
    ...overrides,
  } as AppDeps & { store: ReturnType<typeof memoryStore> };
}

const get = (path: string, init?: RequestInit) => new Request(`https://svc${path}`, init);

describe("handleRequest", () => {
  it("serves the stored signed manifest exactly as published, without needing the key", async () => {
    const d = deps({ signer: null });
    await d.store.put(MANIFEST_KEY, JSON.stringify({ schema: 1, version: 5 }));
    await d.store.put(SIGNED_MANIFEST_KEY, '{"schema":1,"kid":"t1"}');
    const res = await handleRequest(get("/v1/manifest.json"), d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"schema":1,"kid":"t1"}');
  });

  it("never serves an unsigned manifest: 503 when published but not signed yet", async () => {
    const d = deps();
    await d.store.put(MANIFEST_KEY, JSON.stringify({ schema: 1, version: 5 }));
    const res = await handleRequest(get("/v1/manifest.json"), d);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("version");
  });

  it("ignores edits to the stored manifest or config made without the key", async () => {
    const d = deps();
    await d.store.put(
      MANIFEST_KEY,
      JSON.stringify({ schema: 1, version: 5, feeds: DEFAULT_FEED_CONFIG }),
    );
    await resignManifest(d.store, d.signer ?? null);
    const before = await (await handleRequest(get("/v1/manifest.json"), d)).text();
    await d.store.put(MANIFEST_KEY, JSON.stringify({ schema: 1, version: 99 }));
    await d.store.put(CONFIG_KEY, JSON.stringify({ phishing_database: { enabled: true } }));
    expect(await (await handleRequest(get("/v1/manifest.json"), d)).text()).toBe(before);
  });

  it("re-signs the manifest when the admin changes the feed config (kill switch)", async () => {
    const d = deps();
    await d.store.put(
      MANIFEST_KEY,
      JSON.stringify({ schema: 1, version: 5, feeds: DEFAULT_FEED_CONFIG }),
    );
    await resignManifest(d.store, d.signer ?? null);
    const res = await handleRequest(
      get("/admin/config", {
        method: "PUT",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify({ openphish: { enabled: false } }),
      }),
      d,
    );
    expect(res.status).toBe(200);
    const keys = await importPublicKeys({ keys: [{ kid: "t1", publicKey: pair.publicKey }] });
    const served = await (await handleRequest(get("/v1/manifest.json"), d)).text();
    expect((await verifyManifest(served, keys)).feeds.openphish.enabled).toBe(false);
  });

  it("refuses a config change it can't sign, so the served manifest never goes stale", async () => {
    const d = deps({ signer: null });
    await d.store.put(MANIFEST_KEY, JSON.stringify({ schema: 1, version: 5 }));
    const res = await handleRequest(
      get("/admin/config", {
        method: "PUT",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify({ openphish: { enabled: false } }),
      }),
      d,
    );
    expect(res.status).toBe(503);
    expect(await d.store.get(CONFIG_KEY)).toBeNull();
  });

  it("404s the manifest before the first publish", async () => {
    expect((await handleRequest(get("/v1/manifest.json"), deps())).status).toBe(404);
  });

  it("serves every file kind a published manifest points to", async () => {
    const d = deps();
    for (const key of [
      "v1/snapshots/5.json",
      "v1/deltas/4-5.json",
      "v1/allowlist/abc.txt",
      "v1/shared-hosts/3-abc.json",
      "v1/popup-networks/1791-abc.json",
    ]) {
      await d.store.put(key, "{}");
      expect((await handleRequest(get(`/${key}`), d)).status, key).toBe(200);
    }
  });

  it("serves published files as immutable", async () => {
    const d = deps();
    await d.store.put("v1/snapshots/5.json", "{}");
    const res = await handleRequest(get("/v1/snapshots/5.json"), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("never serves state, logs, or config", async () => {
    const d = deps();
    for (const key of ["state/feeds/openphish.json", "logs/quality/1.json", CONFIG_KEY]) {
      await d.store.put(key, "secret");
      expect((await handleRequest(get(`/${key}`), d)).status).toBe(404);
      expect((await handleRequest(get(`/v1/../${key}`), d)).status).toBe(404);
    }
  });

  it("requires the admin token for config", async () => {
    const d = deps();
    expect((await handleRequest(get("/admin/config"), d)).status).toBe(401);
    expect(
      (await handleRequest(get("/admin/config", { headers: { authorization: "Bearer nope" } }), d))
        .status,
    ).toBe(401);
    expect(
      (await handleRequest(get("/admin/config"), deps({ adminToken: undefined }))).status,
    ).toBe(503);
  });

  it("updates config through the admin route (kill switch)", async () => {
    const d = deps();
    const res = await handleRequest(
      get("/admin/config", {
        method: "PUT",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify({ openphish: { enabled: false } }),
      }),
      d,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse((await d.store.get(CONFIG_KEY)) as string).openphish.enabled).toBe(false);
  });

  it("routes the SB proxy", async () => {
    const res = await handleRequest(get("/sb/hashes-search"), deps());
    expect(res.status).toBe(405);
  });
});

describe("admin: suppressed entries", () => {
  const H = "c".repeat(64);
  it("requires the admin token, then stores and returns the normalized list", async () => {
    const d = deps();
    expect((await handleRequest(get("/admin/suppress"), d)).status).toBe(401);
    const put = await handleRequest(
      get("/admin/suppress", {
        method: "PUT",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify([H, "junk", H]),
      }),
      d,
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual([H]);
    const list = await handleRequest(
      get("/admin/suppress", { headers: { authorization: "Bearer secret" } }),
      d,
    );
    expect(await list.json()).toEqual([H]);
    expect((await handleRequest(get("/config/suppress.json"), d)).status).toBe(404); // never public
  });
});
