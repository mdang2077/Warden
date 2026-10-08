/**
 * Stage 2 URL signals (S2.11): supporting signals read from the page URL alone, all in the
 * `urlHost` evidence family. None can make a warning on its own (score.ts needs an anchor
 * from another family). Brands whose names are common words (`needsContext`) are skipped.
 */
import type { Brand, BrandList } from "../brands.ts";
import type { CanonicalUrl } from "../canonicalize.ts";
import { publicSuffix, registrableDomain } from "../psl.ts";
import type { SharedHostList } from "../shared-hosts.ts";

export interface UrlSignals {
  /** The site's own label is punycode, or within one edit of a brand's domain label. */
  lookalike: boolean;
  /** A brand name is a whole token in the host or path, on a site the brand doesn't own. */
  brandKeyword: boolean;
  ipHost: boolean;
  /** A tenant subdomain on a hosting platform (`*.github.io`, `*.000webhostapp.com`…). */
  tenantPlatform: boolean;
  /** 4 or more labels below the registrable domain, not counting a leading `www`. */
  deepSubdomain: boolean;
}

export const NO_URL_SIGNALS: UrlSignals = {
  lookalike: false,
  brandKeyword: false,
  ipHost: false,
  tenantPlatform: false,
  deepSubdomain: false,
};

/** Shorter labels have too many accidental one-edit neighbours. */
const MIN_LOOKALIKE = 5;
const MIN_KEYWORD = 4;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const DIGITS: Record<string, string> = { "0": "o", "1": "l", "3": "e", "5": "s", "8": "b" };

/** Undo common look-alike swaps (`rn` for `m`, `vv` for `w`, digits for letters). */
const fold = (s: string) =>
  s
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[01358]/g, (c) => DIGITS[c] ?? c);

/** True when `a` and `b` differ by at most one insertion, deletion or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === t[i]) i++;
  return s.length === t.length ? s.slice(i + 1) === t.slice(i + 1) : s.slice(i) === t.slice(i + 1);
}

/** The registrable domain with its public suffix removed: `paypa1.com` → `paypa1`. */
function siteLabel(site: string): string {
  const suffix = publicSuffix(site);
  return suffix && site.endsWith(`.${suffix}`) ? site.slice(0, -suffix.length - 1) : site;
}

const contextFree = (brands: BrandList | null): readonly Brand[] =>
  (brands?.brands ?? []).filter((b) => !b.needsContext);

export function urlSignals(
  url: CanonicalUrl | null,
  brands: BrandList | null,
  shared: SharedHostList,
): UrlSignals {
  if (!url) return NO_URL_SIGNALS;
  const host = url.host.replace(/\.$/, "");
  if (IPV4.test(host) || host.startsWith("[")) return { ...NO_URL_SIGNALS, ipHost: true };

  const site = registrableDomain(host);
  const owner = brands?.ownerOf(host);
  const candidates = owner ? [] : contextFree(brands);

  const label = site ? siteLabel(site) : "";
  const lookalike =
    label.startsWith("xn--") ||
    (label.length >= MIN_LOOKALIKE &&
      candidates.some((b) =>
        b.domains.some((d) => {
          const brandLabel = d.split(".")[0] ?? "";
          return (
            brandLabel.length >= MIN_LOOKALIKE &&
            (withinOneEdit(label, brandLabel) || withinOneEdit(fold(label), brandLabel))
          );
        }),
      ));

  const suffix = publicSuffix(host);
  const hostPart = suffix && host.endsWith(`.${suffix}`) ? host.slice(0, -suffix.length - 1) : host;
  const tokens = new Set(`${hostPart}/${url.path.toLowerCase()}`.split(/[./_-]+/).filter(Boolean));
  const brandKeyword = candidates.some((b) =>
    b.aliases.some((a) => a.length >= MIN_KEYWORD && /^[a-z0-9]+$/.test(a) && tokens.has(a)),
  );

  const below = site && host !== site ? host.slice(0, -site.length - 1).split(".") : [];
  if (below[0] === "www") below.shift();

  return {
    lookalike,
    brandKeyword,
    ipHost: false,
    tenantPlatform: shared.isTenant(host),
    deepSubdomain: below.length >= 4,
  };
}
