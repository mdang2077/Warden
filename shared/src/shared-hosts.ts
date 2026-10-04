/**
 * Shared hosts: domains where many unrelated users publish content. Two kinds:
 *
 * - `path`: users share one host and are told apart by path (Google Forms, S3, URL
 *   shorteners). A feed entry matches only its exact path, never the host or a prefix.
 * - `tenant`: each user gets their own subdomain (`*.github.io`, `*.000webhostapp.com`).
 *   A tenant subdomain is treated as its own site and can be matched at host level; the
 *   platform apex (and `www.` on it) gets the `path` treatment, so no entry can ever cover
 *   every tenant.
 *
 * Neither kind is ever allowlisted. See docs/shared-hosts.md for how to add entries.
 */
import { type CanonicalUrl, parseIPv4 } from "./canonicalize.ts";
import { lookupExpressions } from "./expressions.ts";
import { registrableDomain } from "./psl.ts";
import bundled from "./shared-hosts.json" with { type: "json" };

export interface SharedHostEntry {
  /** `example.com` matches that host only; `*.example.com` matches it and every subdomain. */
  pattern: string;
  group: string;
  /** `path` (default) or `tenant`; checked by the loader. `tenant` needs a `*.` pattern. */
  kind?: string;
}

export interface SharedHostsFile {
  version: number;
  updated: string;
  entries: SharedHostEntry[];
}

export interface SharedHostList {
  version: number;
  /** True where only exact-path matching is safe: path-shared hosts and tenant platform apexes. */
  isShared(host: string): boolean;
  /** True for any host the list covers, tenant subdomains included. Never allowlisted. */
  isListed(host: string): boolean;
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
  const tenantSuffixes = new Set<string>();
  for (const { pattern, kind = "path" } of file.entries) {
    if (!PATTERN.test(pattern)) throw new Error(`shared-hosts: bad pattern ${pattern}`);
    if (kind !== "path" && kind !== "tenant") throw new Error(`shared-hosts: bad kind ${kind}`);
    if (kind === "tenant") {
      if (!pattern.startsWith("*.")) throw new Error(`shared-hosts: tenant needs *. (${pattern})`);
      tenantSuffixes.add(pattern.slice(2));
    } else if (pattern.startsWith("*.")) suffixes.add(pattern.slice(2));
    else exact.add(pattern);
  }

  /** Whether some proper suffix of `host` (or `host` itself) is in `set`. */
  const underSuffix = (host: string, set: Set<string>, includeSelf: boolean) => {
    if (includeSelf && set.has(host)) return true;
    for (let i = host.indexOf("."); i !== -1; i = host.indexOf(".", i + 1)) {
      if (set.has(host.slice(i + 1))) return true;
    }
    return false;
  };
  /** The platform apex when `host` is strictly below a tenant platform, else null. */
  const tenantApex = (host: string): string | null => {
    for (let i = host.indexOf("."); i !== -1; i = host.indexOf(".", i + 1)) {
      const suffix = host.slice(i + 1);
      if (tenantSuffixes.has(suffix)) return suffix;
    }
    return null;
  };

  const isShared = (host: string): boolean => {
    if (exact.has(host) || underSuffix(host, suffixes, true)) return true;
    if (tenantSuffixes.has(host)) return true;
    const apex = tenantApex(host);
    return apex !== null && host === `www.${apex}`;
  };

  return {
    version: file.version,
    isShared,
    isListed: (host) => isShared(host) || tenantApex(host) !== null,
    hasSharedBelow(host) {
      const tail = `.${host}`;
      for (const set of [exact, suffixes, tenantSuffixes]) {
        for (const h of set) if (h.endsWith(tail)) return true;
      }
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
 * - elsewhere (tenant subdomains included), the normal SB expressions minus any whose
 *   host is shared or a public suffix, so a lookup never reaches a platform apex.
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
 * A bare tenant subdomain (`evil.github.io/`) is allowed: it covers one tenant.
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
