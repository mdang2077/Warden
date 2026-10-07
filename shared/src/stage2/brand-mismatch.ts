/**
 * Stage 2 brand mismatch (S2.6, part 2 of 2): the page claims a brand (brand-claim.ts) but
 * its registrable domain isn't one the brand owns. Uses the PSL with the private section,
 * so a hosting-platform tenant (`user.github.io`) is its own site.
 */
import type { BrandList } from "../brands.ts";
import { registrableDomain } from "../psl.ts";
import type { BrandClaim } from "./brand-claim.ts";

export function brandMismatch(claim: BrandClaim, pageHost: string, brands: BrandList): boolean {
  const brand = brands.byId(claim.brand);
  if (!brand) return false;
  const domain = registrableDomain(pageHost) ?? pageHost;
  return !brand.domains.includes(domain);
}
