/**
 * Safe Browsing v5 `hashes.search` proxy: `POST /sb/hashes-search {prefixes: base64[]}`.
 * Adds the API key so it never ships in the extension. Privacy rules:
 * - only 4-byte prefixes are accepted, at most 30 per request (one URL's expressions);
 * - nothing about the request is logged, and prefixes are never stored with an IP;
 * - the rate-limit key is a SHA-256 of the client IP, never the IP itself.
 */
import { sha256Hex } from "@warden/shared/feed-format";

export const SB_ENDPOINT = "https://safebrowsing.googleapis.com/v5/hashes:search";
export const MAX_PREFIXES = 30;
const MAX_BODY_BYTES = 4096;

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Per-prefix answers shared by all clients (Workers Cache API in production). */
export interface PrefixCache {
  get(prefix: string): Promise<{ value: unknown; expiresAt: number } | null>;
  put(prefix: string, value: unknown, expiresAt: number): Promise<void>;
}

/** Caps calls to Google across all clients; `take` is false once the budget is spent. */
export interface UpstreamBudget {
  take(): Promise<boolean>;
}

export interface SbProxyDeps {
  apiKey: string | undefined;
  limiter: RateLimiter | undefined;
  fetch: typeof fetch;
  cache?: PrefixCache;
  budget?: UpstreamBudget;
  now?: () => number;
}

/**
 * Safe Browsing terms: a URL may only be treated as unsafe on data refreshed within the past
 * 30 minutes. The proxy caches for at most this long and tells clients only the remaining
 * time, so proxy and client caches together never exceed it.
 */
export const MAX_CACHE_MS = 30 * 60_000;
const DEFAULT_CACHE_MS = 5 * 60_000;

interface FullHash {
  fullHash: string;
  fullHashDetails?: unknown[];
}

function parseDuration(duration: unknown): number {
  const m = typeof duration === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(duration) : null;
  return m?.[1] ? Math.round(Number(m[1]) * 1000) : DEFAULT_CACHE_MS;
}

/** The base64 4-byte prefix of a base64 full hash, or null if it doesn't decode. */
function prefixOf(fullHash: string): string | null {
  try {
    return btoa(atob(fullHash).slice(0, 4));
  } catch {
    return null;
  }
}

export async function handleSbSearch(request: Request, deps: SbProxyDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!deps.apiKey) return json({ error: "not configured" }, 503);

  if (deps.limiter) {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await deps.limiter.limit({ key: await sha256Hex(`sb:${ip}`) });
    if (!success) return json({ error: "rate limited" }, 429);
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);
  const prefixes = parsePrefixes(body);
  if (!prefixes) return json({ error: "expected {prefixes: base64 4-byte strings}" }, 400);

  const now = deps.now ?? Date.now;
  const t = now();
  const answers = new Map<string, { fullHashes: FullHash[]; expiresAt: number }>();
  const missing: string[] = [];
  for (const p of prefixes) {
    const hit = await deps.cache?.get(p).catch(() => null);
    const value = hit?.value as { fullHashes?: FullHash[] } | undefined;
    if (hit && hit.expiresAt > t && Array.isArray(value?.fullHashes)) {
      answers.set(p, { fullHashes: value.fullHashes, expiresAt: hit.expiresAt });
    } else {
      missing.push(p);
    }
  }

  if (missing.length) {
    // Over budget: refuse rather than answer partially; a partial answer would look like
    // "no hit" for the prefixes not asked, and the client would cache that.
    if (deps.budget && !(await deps.budget.take())) return json({ error: "over budget" }, 503);

    const url = new URL(SB_ENDPOINT);
    url.searchParams.set("key", deps.apiKey);
    for (const p of missing) url.searchParams.append("hashPrefixes", p);
    let upstream: Response;
    try {
      upstream = await deps.fetch(url.toString(), { headers: { accept: "application/json" } });
    } catch {
      return json({ error: "upstream unavailable" }, 502);
    }
    if (!upstream.ok) return json({ error: "upstream error" }, 502);
    let parsed: { fullHashes?: FullHash[]; cacheDuration?: unknown };
    try {
      parsed = (await upstream.json()) as typeof parsed;
    } catch {
      return json({ error: "upstream error" }, 502);
    }
    const expiresAt = t + Math.min(parseDuration(parsed.cacheDuration), MAX_CACHE_MS);
    const fullHashes = Array.isArray(parsed.fullHashes) ? parsed.fullHashes : [];
    for (const p of missing) {
      const entry = { fullHashes: fullHashes.filter((h) => prefixOf(h.fullHash) === p), expiresAt };
      answers.set(p, entry);
      await deps.cache?.put(p, { fullHashes: entry.fullHashes }, expiresAt).catch(() => {});
    }
  }

  const all = [...answers.values()];
  const remainingMs = Math.min(...all.map((a) => a.expiresAt - t));
  return json(
    {
      fullHashes: all.flatMap((a) => a.fullHashes),
      cacheDuration: `${Math.max(0, Math.floor(remainingMs / 1000))}s`,
    },
    200,
  );
}

export function parsePrefixes(body: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const prefixes = (parsed as { prefixes?: unknown } | null)?.prefixes;
  if (!Array.isArray(prefixes) || prefixes.length === 0 || prefixes.length > MAX_PREFIXES) {
    return null;
  }
  for (const p of prefixes) {
    if (typeof p !== "string" || !/^[A-Za-z0-9+/]{6}==$/.test(p)) return null;
  }
  return [...new Set(prefixes as string[])];
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
