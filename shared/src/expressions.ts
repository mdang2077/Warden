/**
 * Safe Browsing lookup expressions: host suffixes × path prefixes of a canonical URL,
 * plus SHA-256 hashing and 4-byte prefixes. See "URLs and Hashing" → "Suffix/Prefix
 * Expressions" in the Safe Browsing API docs.
 */
import { type CanonicalUrl, canonicalize, parseIPv4 } from "./canonicalize.ts";

/** At most 5 hosts: the exact host plus up to 4 suffixes built from the last 5 components. */
export function hostSuffixes(host: string): string[] {
  if (host.startsWith("[") || parseIPv4(host) === host) return [host];
  const parts = host.split(".");
  const hosts = [host];
  const start = Math.max(1, parts.length - 5);
  // Stop before the last component: a bare TLD is never a lookup host.
  for (let i = start; i < parts.length - 1; i++) hosts.push(parts.slice(i).join("."));
  return [...new Set(hosts)];
}

/**
 * At most 6 paths: the exact path with query, the exact path without query, and up to
 * 4 prefixes from `/` appending one component (with trailing slash) at a time.
 */
export function pathPrefixes(path: string, query: string | null): string[] {
  const paths: string[] = [];
  if (query !== null) paths.push(`${path}?${query}`);
  paths.push(path);

  const components = path.split("/").filter(Boolean);
  // The last component is a prefix only when the path ends in a slash.
  const dirs = path.endsWith("/") ? components : components.slice(0, -1);
  let prefix = "/";
  paths.push(prefix);
  for (const dir of dirs.slice(0, 3)) {
    prefix += `${dir}/`;
    paths.push(prefix);
  }
  return [...new Set(paths)];
}

/** All lookup expressions (`host/path?query`, no scheme) for a canonical URL. */
export function lookupExpressions(url: CanonicalUrl): string[] {
  const out: string[] = [];
  for (const host of hostSuffixes(url.host)) {
    for (const path of pathPrefixes(url.path, url.query)) out.push(host + path);
  }
  return out;
}

/** The single expression a feed entry contributes: its exact canonical host + path + query. */
export function entryExpression(url: CanonicalUrl): string {
  return url.host + url.path + (url.query === null ? "" : `?${url.query}`);
}

/** Convenience: canonicalize then expand. Empty when the URL can't be canonicalized. */
export function expressionsForUrl(rawUrl: string): string[] {
  const url = canonicalize(rawUrl);
  return url ? lookupExpressions(url) : [];
}

export async function sha256(expression: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expression));
  return new Uint8Array(digest);
}

export function hashPrefix(hash: Uint8Array, bytes = 4): Uint8Array {
  return hash.slice(0, bytes);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export interface HashedExpression {
  expression: string;
  /** Full SHA-256, hex. */
  hash: string;
  /** First 4 bytes of the hash, hex. */
  prefix: string;
}

export async function hashExpressions(expressions: readonly string[]): Promise<HashedExpression[]> {
  return Promise.all(
    expressions.map(async (expression) => {
      const hash = await sha256(expression);
      return { expression, hash: toHex(hash), prefix: toHex(hashPrefix(hash)) };
    }),
  );
}
