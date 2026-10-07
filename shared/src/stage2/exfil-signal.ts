/**
 * Stage 2 credential-exfiltration signal (S2.7, part 2 of 2): turns the content script's
 * scan (exfil-scan.ts) into an anchor signal. An exfil endpoint in page code fires as is; a
 * login form posting to a different site (registrable domain, PSL with the private section)
 * fires unless the target is a known sign-in provider. A visitor-IP lookup is carried as a
 * supporting flag only.
 */
import { registrableDomain } from "../psl.ts";
import type { ExfilEndpoint, ExfilScan } from "./exfil-scan.ts";
import idp from "./idp-domains.json" with { type: "json" };

export type ExfilKind = ExfilEndpoint | "crossSiteForm";

export interface ExfilSignal {
  /** Null when only the supporting IP-lookup flag is set. */
  kind: ExfilKind | null;
  ip: boolean;
}

/** Sign-in providers whose login forms legitimately live on another site. */
export const idpDomains: readonly string[] = idp.domains;
const IDP = new Set(idpDomains);

const siteOf = (host: string) => registrableDomain(host) ?? host;

export function exfilSignal(scan: ExfilScan, pageHost: string): ExfilSignal | null {
  const page = siteOf(pageHost);
  const crossSite = scan.formHosts.some((h) => {
    const site = siteOf(h);
    return site !== page && !IDP.has(site);
  });
  const kind: ExfilKind | null = scan.endpoint ?? (crossSite ? "crossSiteForm" : null);
  if (!kind && !scan.ip) return null;
  return { kind, ip: scan.ip };
}
