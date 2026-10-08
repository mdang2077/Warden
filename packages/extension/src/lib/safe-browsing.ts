/**
 * Safe Browsing v5 `hashes.search` client, via the Warden backend proxy (which holds the
 * API key). Only 4-byte hash prefixes leave the device; full hashes are compared locally.
 *
 * - Results are cached per prefix for the `cacheDuration` SB returns (hits and misses).
 * - The request times out after 1.5 s; any failure is reported as an error, not a hit.
 * - Only SOCIAL_ENGINEERING (phishing) counts. Entries marked CANARY (not for enforcement)
 *   or FRAME_ONLY (not for top-level pages) are ignored.
 */
import type { CanonicalUrl } from "@warden/shared/canonicalize";
import { hashExpressions, lookupExpressions } from "@warden/shared/expressions";
import type { SafeBrowsing, SafeBrowsingVerdict } from "@warden/shared/stage1";

export const SB_TIMEOUT_MS = 1500;
const DEFAULT_CACHE_MS = 5 * 60_000;
const PHISHING = "SOCIAL_ENGINEERING";
const IGNORED_ATTRIBUTES = new Set(["CANARY", "FRAME_ONLY"]);

/** Response shape of `POST /sb/hashes-search` (Safe Browsing v5 SearchHashesResponse). */
export interface SearchHashesResponse {
  fullHashes?: {
    fullHash: string;
    fullHashDetails?: { threatType?: string; attributes?: string[] }[];
  }[];
  cacheDuration?: string;
}

export interface SafeBrowsingClientOptions {
  /** Proxy URL, e.g. `https://warden.example.workers.dev/sb/hashes-search`. */
  endpoint: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

interface CacheEntry {
  /** Full hashes (hex) for this prefix that are phishing and enforceable. */
  phishingHashes: Set<string>;
  expiresAt: number;
}

export function createSafeBrowsingClient(options: SafeBrowsingClientOptions): SafeBrowsing {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? SB_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();

  async function search(prefixes: string[]): Promise<SearchHashesResponse> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Our own timer as well as the abort signal, so a fetch that ignores aborts can't hang.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    const request = (async () => {
      const res = await doFetch(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefixes: prefixes.map(hexToBase64) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`proxy returned ${res.status}`);
      return (await res.json()) as SearchHashesResponse;
    })();
    request.catch(() => {}); // the timeout may win; don't leave the loser unhandled
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async check(url: CanonicalUrl): Promise<SafeBrowsingVerdict> {
      const hashed = await hashExpressions(lookupExpressions(url));
      const t = now();
      for (const [prefix, entry] of cache) if (entry.expiresAt <= t) cache.delete(prefix);

      const missing = [...new Set(hashed.map((h) => h.prefix))].filter((p) => !cache.has(p));
      let error: string | undefined;
      if (missing.length) {
        try {
          const response = await search(missing);
          const expiresAt = now() + parseDuration(response.cacheDuration);
          for (const prefix of missing) cache.set(prefix, { phishingHashes: new Set(), expiresAt });
          for (const full of response.fullHashes ?? []) {
            const hash = base64ToHex(full.fullHash);
            const entry = cache.get(hash.slice(0, 8));
            if (entry && (full.fullHashDetails ?? []).some(isEnforceablePhishing)) {
              entry.phishingHashes.add(hash);
            }
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }

      const expressions = hashed
        .filter((h) => cache.get(h.prefix)?.phishingHashes.has(h.hash))
        .map((h) => h.expression);
      return { hit: expressions.length > 0, expressions, ...(error ? { error } : {}) };
    },
  };
}

function isEnforceablePhishing(d: { threatType?: string; attributes?: string[] }): boolean {
  return d.threatType === PHISHING && !(d.attributes ?? []).some((a) => IGNORED_ATTRIBUTES.has(a));
}

/** Parses a protobuf Duration string like `"300s"` or `"12.5s"` into milliseconds. */
export function parseDuration(duration: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(duration ?? "");
  return m?.[1] ? Math.round(Number(m[1]) * 1000) : DEFAULT_CACHE_MS;
}

export function hexToBase64(hex: string): string {
  let bin = "";
  for (let i = 0; i < hex.length; i += 2)
    bin += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin);
}

export function base64ToHex(b64: string): string {
  let hex = "";
  for (const ch of atob(b64)) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return hex;
}
