import { describe, expect, it, vi } from "vitest";
import { type AppDeps, handleRequest } from "./app.ts";
import { CONFIG_KEY, DEFAULT_FEED_CONFIG } from "./config.ts";
import { MANIFEST_KEY } from "./publish.ts";
import { memoryStore } from "./storage.ts";

function deps(
  overrides: Partial<AppDeps> = {},
): AppDeps & { store: ReturnType<typeof memoryStore> } {
  return {
    store: memoryStore(),
    fetch: vi.fn() as unknown as typeof fetch,
    sbApiKey: "KEY",
    sbLimiter: undefined,
    adminToken: "secret",
    ...overrides,
  } as AppDeps & { store: ReturnType<typeof memoryStore> };
}

const get = (path: string, init?: RequestInit) => new Request(`https://svc${path}`, init);

describe("handleRequest", () => {
  it("serves the manifest with the live config overlaid", async () => {
    const d = deps();
    await d.store.put(MANIFEST_KEY, JSON.stringify({ version: 5, feeds: DEFAULT_FEED_CONFIG }));
    await d.store.put(CONFIG_KEY, JSON.stringify({ openphish: { enabled: false, tier: "A" } }));
    const res = await handleRequest(get("/v1/manifest.json"), d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; feeds: typeof DEFAULT_FEED_CONFIG };
    expect(body.version).toBe(5);
    expect(body.feeds.openphish.enabled).toBe(false);
  });

  it("404s the manifest before the first publish", async () => {
    expect((await handleRequest(get("/v1/manifest.json"), deps())).status).toBe(404);
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
