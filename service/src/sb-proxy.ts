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

export interface SbProxyDeps {
  apiKey: string | undefined;
  limiter: RateLimiter | undefined;
  fetch: typeof fetch;
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

  const url = new URL(SB_ENDPOINT);
  url.searchParams.set("key", deps.apiKey);
  for (const p of prefixes) url.searchParams.append("hashPrefixes", p);

  let upstream: Response;
  try {
    upstream = await deps.fetch(url.toString(), { headers: { accept: "application/json" } });
  } catch {
    return json({ error: "upstream unavailable" }, 502);
  }
  if (!upstream.ok) return json({ error: "upstream error" }, 502);
  return new Response(await upstream.text(), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
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
