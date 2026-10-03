/**
 * Shared hosts: domains where many unrelated users publish content (Google Forms, S3,
 * github.io, URL shorteners, …). On these hosts a feed entry may only match its exact
 * path, never a whole host or a path prefix, so one reported phish can't block everyone
 * else's content. See docs/shared-hosts.md for how to add entries.
 */
import { type CanonicalUrl, parseIPv4 } from "./canonicalize.ts";
import { lookupExpressions } from "./expressions.ts";
import { registrableDomain } from "./psl.ts";
import bundled from "./shared-hosts.json" with { type: "json" };

export interface SharedHostEntry {
  /** `example.com` matches that host only; `*.example.com` matches it and every subdomain. */
  pattern: string;
  group: string;
}

export interface SharedHostsFile {
  version: number;
  updated: string;
  entries: SharedHostEntry[];
}

export interface SharedHostList {
  version: number;
  isShared(host: string): boolean;
  /** True when some shared host is a strict subdomain of `host` (e.g. `googleapis.com`). */
  hasSharedBelow(host: string): boolean;
}

const PATTERN = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function loadSharedHosts(file: SharedHostsFile): SharedHostList {
  if (!Number.isInteger(file.version) || file.version < 1) {
    throw new Error(`shared-hosts: bad version ${file.version}`);
  }
  const exact = new Set<string>();
  const suffixes = new Set<string>();
  for (const { pattern } of file.entries) {
    if (!PATTERN.test(pattern)) throw new Error(`shared-hosts: bad pattern ${pattern}`);
    if (pattern.startsWith("*.")) suffixes.add(pattern.slice(2));
    else exact.add(pattern);
  }

  return {
    version: file.version,
    isShared(host) {
      if (exact.has(host) || suffixes.has(host)) return true;
      for (let i = host.indexOf("."); i !== -1; i = host.indexOf(".", i + 1)) {
        if (suffixes.has(host.slice(i + 1))) return true;
      }
      return false;
    },
    hasSharedBelow(host) {
      const tail = `.${host}`;
      for (const h of exact) if (h.endsWith(tail)) return true;
      for (const h of suffixes) if (h.endsWith(tail)) return true;
      return false;
    },
  };
}

/** The raw list bundled with this build; the service publishes it with each snapshot. */
export const bundledSharedHostsFile: SharedHostsFile = bundled;

/** The list bundled with this build. */
export const bundledSharedHosts: SharedHostList = loadSharedHosts(bundled);

/**
 * Lookup expressions with shared-host protection applied:
 * - on a shared host, only the exact path (with and without query) on the exact host;
 * - elsewhere, the normal SB expressions minus any whose host is shared.
 */
export function protectedLookupExpressions(url: CanonicalUrl, shared: SharedHostList): string[] {
  if (shared.isShared(url.host)) {
    const exact = [url.host + url.path];
    if (url.query !== null) exact.unshift(`${url.host}${url.path}?${url.query}`);
    return exact;
  }
  return lookupExpressions(url).filter((e) => {
    const host = e.slice(0, e.indexOf("/"));
    return !shared.isShared(host) && !isPublicSuffixHost(host);
  });
}

/**
 * Whether a feed entry may enter the blocklist at all. Rejected:
 * - a host that is itself a public suffix (`co.uk`, `pages.dev`): as a host-suffix match it
 *   would cover every site under that suffix;
 * - a bare host (path `/`, no query) on a shared host: "block this whole platform".
 */
export function isEntryAllowed(entry: CanonicalUrl, shared: SharedHostList): boolean {
  if (isPublicSuffixHost(entry.host)) return false;
  if (!shared.isShared(entry.host)) return true;
  return !(entry.path === "/" && entry.query === null);
}

/** True for hosts with no registrable domain of their own, other than IP literals. */
export function isPublicSuffixHost(host: string): boolean {
  if (host.startsWith("[") || parseIPv4(host) === host) return false;
  return registrableDomain(host) === null;
}
