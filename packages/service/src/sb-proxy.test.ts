import { describe, expect, it, vi } from "vitest";
import { handleSbSearch, MAX_PREFIXES, parsePrefixes, SB_ENDPOINT } from "./sb-proxy.ts";

const PREFIX = btoa("\x01\x02\x03\x04");

function req(body: unknown, init: RequestInit = {}) {
  return new Request("https://svc/sb/hashes-search", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "cf-connecting-ip": "203.0.113.9" },
    ...init,
  });
}

function upstream(body: unknown = { fullHashes: [], cacheDuration: "300s" }, status = 200) {
  return vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

const allow = { limit: vi.fn(async () => ({ success: true })) };

describe("parsePrefixes", () => {
  it("accepts base64 4-byte prefixes and dedupes", () => {
    expect(parsePrefixes(JSON.stringify({ prefixes: [PREFIX, PREFIX] }))).toEqual([PREFIX]);
  });

  it.each([
    "not json",
    "null",
    "{}",
    JSON.stringify({ prefixes: [] }),
    JSON.stringify({ prefixes: [btoa("\x01\x02\x03\x04\x05")] }),
    JSON.stringify({ prefixes: [btoa("abc")] }),
    JSON.stringify({ prefixes: [42] }),
    JSON.stringify({ prefixes: Array(MAX_PREFIXES + 1).fill(PREFIX) }),
  ])("rejects %s", (body) => {
    expect(parsePrefixes(body)).toBeNull();
  });
});

describe("handleSbSearch", () => {
  it("forwards prefixes with the key and passes the response through", async () => {
    const f = upstream();
    const res = await handleSbSearch(req({ prefixes: [PREFIX] }), {
      apiKey: "KEY",
      limiter: allow,
      fetch: f as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fullHashes: [], cacheDuration: "300s" });
    const called = new URL(String(f.mock.calls[0]?.[0]));
    expect(called.origin + called.pathname).toBe(SB_ENDPOINT);
    expect(called.searchParams.get("key")).toBe("KEY");
    expect(called.searchParams.get("alt")).toBe("json");
    expect(called.searchParams.getAll("hashPrefixes")).toEqual([PREFIX]);
  });

  it("calls fetch without a `this`, as the Workers runtime requires", async () => {
    const answer = new Response(JSON.stringify({ fullHashes: [], cacheDuration: "300s" }));
    const strictFetch = function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      return Promise.resolve(answer);
    };
    const res = await handleSbSearch(req({ prefixes: [PREFIX] }), {
      apiKey: "KEY",
      limiter: allow,
      fetch: strictFetch as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
  });

  it("rate-limits on a hash of the IP, never the IP itself", async () => {
    const limiter = { limit: vi.fn(async (_o: { key: string }) => ({ success: false })) };
    const res = await handleSbSearch(req({ prefixes: [PREFIX] }), {
      apiKey: "KEY",
      limiter,
      fetch: upstream() as typeof fetch,
    });
    expect(res.status).toBe(429);
    const key = limiter.limit.mock.calls[0]?.[0].key ?? "";
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.9");
  });

  it("rejects bad input, wrong methods, and big bodies", async () => {
    const deps = { apiKey: "KEY", limiter: allow, fetch: upstream() as typeof fetch };
    expect((await handleSbSearch(req({ prefixes: ["x"] }), deps)).status).toBe(400);
    expect((await handleSbSearch(new Request("https://svc/sb/hashes-search"), deps)).status).toBe(
      405,
    );
    expect((await handleSbSearch(req("x".repeat(5000)), deps)).status).toBe(413);
  });

  it("returns 503 when no API key is configured", async () => {
    const res = await handleSbSearch(req({ prefixes: [PREFIX] }), {
      apiKey: undefined,
      limiter: allow,
      fetch: upstream() as typeof fetch,
    });
    expect(res.status).toBe(503);
  });

  it("returns 502 on upstream errors without leaking details", async () => {
    for (const f of [
      upstream({ error: { message: "API key invalid KEY" } }, 400),
      vi.fn(async () => Promise.reject(new Error("dns"))),
    ]) {
      const res = await handleSbSearch(req({ prefixes: [PREFIX] }), {
        apiKey: "KEY",
        limiter: allow,
        fetch: f as typeof fetch,
      });
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain("KEY");
    }
  });

  it("never logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m),
    );
    await handleSbSearch(req({ prefixes: [PREFIX] }), {
      apiKey: "KEY",
      limiter: allow,
      fetch: upstream() as typeof fetch,
    });
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

describe("sb proxy: shared cache and upstream budget (T4b.5)", () => {
  const P1 = btoa("\x01\x02\x03\x04");
  const P2 = btoa("\x05\x06\x07\x08");
  // A full hash whose first 4 bytes are P1's.
  const FULL1 = btoa(`\x01\x02\x03\x04${"x".repeat(28)}`);
  const hit = { fullHash: FULL1, fullHashDetails: [{ threatType: "SOCIAL_ENGINEERING" }] };

  function memoryCache() {
    const m = new Map<string, { value: unknown; expiresAt: number }>();
    return {
      m,
      async get(k: string) {
        const e = m.get(k);
        return e ? e : null;
      },
      async put(k: string, value: unknown, expiresAt: number) {
        m.set(k, { value, expiresAt });
      },
    };
  }

  function setup(body: unknown = { fullHashes: [hit], cacheDuration: "600s" }) {
    let t = 1_000_000;
    const f = upstream(body);
    const cache = memoryCache();
    const budget = { take: vi.fn(async () => true) };
    const deps = {
      apiKey: "KEY",
      limiter: allow,
      fetch: f as typeof fetch,
      cache,
      budget,
      now: () => t,
    };
    return { f, cache, budget, deps, advance: (ms: number) => (t += ms) };
  }
  const body = async (res: Response) =>
    (await res.json()) as { fullHashes?: unknown[]; cacheDuration?: string };

  it("answers a repeated prefix from the shared cache without asking Google", async () => {
    const { f, deps } = setup();
    await handleSbSearch(req({ prefixes: [P1] }), deps);
    const res = await handleSbSearch(req({ prefixes: [P1] }), deps);
    expect(f).toHaveBeenCalledTimes(1);
    expect((await body(res)).fullHashes).toEqual([hit]);
  });

  it("asks Google only for the prefixes it hasn't cached", async () => {
    const { f, deps } = setup();
    await handleSbSearch(req({ prefixes: [P1] }), deps);
    await handleSbSearch(req({ prefixes: [P1, P2] }), deps);
    expect(f).toHaveBeenCalledTimes(2);
    const asked = new URL(String(f.mock.calls[1]?.[0])).searchParams.getAll("hashPrefixes");
    expect(asked).toEqual([P2]);
  });

  it("tells clients only the remaining freshness, so cached data never exceeds 30 minutes", async () => {
    const { deps, advance } = setup({ fullHashes: [], cacheDuration: "7200s" });
    const first = await body(await handleSbSearch(req({ prefixes: [P1] }), deps));
    expect(first.cacheDuration).toBe("1800s"); // capped at 30 minutes
    advance(10 * 60_000);
    const later = await body(await handleSbSearch(req({ prefixes: [P1] }), deps));
    expect(later.cacheDuration).toBe("1200s");
  });

  it("asks Google again once a cached entry has expired", async () => {
    const { f, deps, advance } = setup({ fullHashes: [], cacheDuration: "300s" });
    await handleSbSearch(req({ prefixes: [P1] }), deps);
    advance(301_000);
    await handleSbSearch(req({ prefixes: [P1] }), deps);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("refuses with 503 when the upstream budget is spent, instead of a partial answer", async () => {
    const { f, deps } = setup();
    await handleSbSearch(req({ prefixes: [P1] }), deps); // P1 now cached
    deps.budget.take.mockResolvedValue(false);
    const cachedOnly = await handleSbSearch(req({ prefixes: [P1] }), deps);
    expect(cachedOnly.status).toBe(200); // fully cached: no budget needed
    const needsGoogle = await handleSbSearch(req({ prefixes: [P1, P2] }), deps);
    expect(needsGoogle.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("doesn't cache upstream failures", async () => {
    const { cache, deps } = setup();
    deps.fetch = upstream({}, 500) as typeof fetch;
    await handleSbSearch(req({ prefixes: [P1] }), deps);
    expect(cache.m.size).toBe(0);
  });
});
