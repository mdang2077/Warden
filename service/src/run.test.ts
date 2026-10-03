import type { Manifest, Snapshot } from "@warden/shared/feed-format";
import { describe, expect, it, vi } from "vitest";
import { TRANCO_BASE } from "./allowlist-source.ts";
import { saveConfig } from "./config.ts";
import { OPENPHISH_URL } from "./feeds/openphish.ts";
import { MANIFEST_KEY } from "./publish.ts";
import { runPipeline } from "./run.ts";
import { getJson, memoryStore } from "./storage.ts";

// The real allowlist is 100k domains; the test pads Tranco so the size check passes.
const TRANCO = [
  "google.com",
  "paypal.com",
  ...Array.from({ length: 60_000 }, (_, i) => `site${i}.com`),
]
  .map((d, i) => `${i + 1},${d}`)
  .join("\n");

const OPENPHISH = [
  "https://evil.example/login",
  "https://www.paypal.com/signin", // allowlisted → dropped
  "https://evil.github.io/", // bare host on a shared host → dropped
  "https://docs.google.com/forms/d/X/viewform", // path-specific on a shared host → kept
].join("\n");

function fakeFetch(openphishBody = OPENPHISH) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url === `${TRANCO_BASE}/top-1m-id`) return new Response("ID1");
    if (url.startsWith(`${TRANCO_BASE}/download/ID1/`)) return new Response(TRANCO);
    if (url === OPENPHISH_URL) return new Response(openphishBody);
    if (url === "https://hooks.example/alert") return new Response("ok");
    return new Response("not found", { status: 404 });
  });
}

describe("runPipeline", () => {
  it("ingests, cleans, publishes, and logs quality", async () => {
    const store = memoryStore();
    const log = await runPipeline({ store, fetch: fakeFetch() as typeof fetch, now: 1_000 });

    expect(log.published).toBe(true);
    expect(log.feeds.openphish).toMatchObject({
      ingested: 4,
      dropped_allowlist: 1,
      dropped_shared_host: 1,
      kept: 2,
    });
    const manifest = (await getJson<Manifest>(store, MANIFEST_KEY)) as Manifest;
    const snapshot = await getJson<Snapshot>(store, manifest.snapshot.key);
    expect(snapshot?.feeds.openphish?.map((e) => e.expression).sort()).toEqual([
      "docs.google.com/forms/d/X/viewform",
      "evil.example/login",
    ]);
    expect(Object.keys(snapshot?.feeds ?? {})).toEqual(["openphish"]);
  });

  it("publishes nothing without an allowlist", async () => {
    const store = memoryStore();
    const failing = vi.fn(async () => new Response("", { status: 503 }));
    const log = await runPipeline({ store, fetch: failing as typeof fetch, now: 1_000 });
    expect(log.published).toBe(false);
    expect(log.alerts[0]).toContain("no allowlist");
    expect(await store.get(MANIFEST_KEY)).toBeNull();
  });

  it("respects the kill switch", async () => {
    const store = memoryStore();
    await saveConfig(store, { openphish: { enabled: false } });
    const f = fakeFetch();
    const log = await runPipeline({ store, fetch: f as typeof fetch, now: 1_000 });
    expect(log.feeds).toEqual({});
    expect(f.mock.calls.some(([u]) => String(u) === OPENPHISH_URL)).toBe(false);
  });

  it("sends spike alerts to the webhook", async () => {
    const store = memoryStore();
    const junk = Array.from({ length: 10 }, (_, i) => `https://site${i}.com/x`).join("\n");
    const f = fakeFetch(junk);
    const log = await runPipeline({
      store,
      fetch: f as typeof fetch,
      now: 1_000,
      alertWebhook: "https://hooks.example/alert",
    });
    expect(log.alerts.some((a) => a.includes("openphish"))).toBe(true);
    expect(f.mock.calls.some(([u]) => String(u) === "https://hooks.example/alert")).toBe(true);
  });
});
