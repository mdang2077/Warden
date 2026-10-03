/**
 * Registrable domains from the Public Suffix List, *including the private section*:
 * `a.github.io` and `b.github.io` are different sites, as are `x.web.app` and `y.pages.dev`.
 */
import { getDomain, getPublicSuffix } from "tldts";

const OPTIONS = { allowPrivateDomains: true } as const;

/**
 * The registrable domain (eTLD+1) of a canonical host, or null for IPs, bare public
 * suffixes, and hosts the PSL can't place.
 */
export function registrableDomain(host: string): string | null {
  return getDomain(host, OPTIONS);
}

/** The public suffix of a host, counting private-section suffixes like `github.io`. */
export function publicSuffix(host: string): string | null {
  return getPublicSuffix(host, OPTIONS);
}

/** True when two hosts belong to the same registrable domain. */
export function sameSite(a: string, b: string): boolean {
  const da = registrableDomain(a);
  return da !== null && da === registrableDomain(b);
}
