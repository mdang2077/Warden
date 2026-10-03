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
    expect(called.searchParams.getAll("hashPrefixes")).toEqual([PREFIX]);
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
