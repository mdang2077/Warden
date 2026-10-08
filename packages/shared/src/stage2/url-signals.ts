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

/** Shorter brand labels collide with too many unrelated names. */
const MIN_LOOKALIKE = 5;
const MIN_KEYWORD = 4;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const DIGITS: Record<string, string> = { "0": "o", "1": "l", "3": "e", "5": "s", "8": "b" };
/** Cyrillic and Greek letters that render like Latin ones in a lowercase hostname. */
const CONFUSABLE: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ԁ: "d",
  ѕ: "s",
  ӏ: "l",
  к: "k",
  ο: "o",
  α: "a",
  ν: "v",
  ρ: "p",
  ι: "i",
  κ: "k",
};

/** Undo common look-alike swaps (`rn` for `m`, `vv` for `w`, digits and Cyrillic/Greek for Latin). */
const fold = (s: string) =>
  [...s]
    .map((c) => CONFUSABLE[c] ?? c)
    .join("")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[01358]/g, (c) => DIGITS[c] ?? c);

/** True when `label` is `brand` with one letter doubled (`paypall`, `microsofft`). */
function doubledLetter(label: string, brand: string): boolean {
  if (label.length !== brand.length + 1) return false;
  for (let i = 0; i < brand.length; i++) {
    if (`${brand.slice(0, i + 1)}${brand.slice(i)}` === label) return true;
  }
  return false;
}

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;

function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / 700) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + 38));
}

/** RFC 3492 decoding of one label's ACE part (after `xn--`); null if malformed. */
export function decodePunycode(input: string): string | null {
  const dash = input.lastIndexOf("-");
  const out: number[] = [];
  for (const ch of dash > 0 ? input.slice(0, dash) : "") {
    if (ch.charCodeAt(0) >= 0x80) return null;
    out.push(ch.charCodeAt(0));
  }
  let n = 0x80;
  let i = 0;
  let bias = 72;
  for (let pos = dash > 0 ? dash + 1 : 0; pos < input.length; ) {
    const old = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return null;
      const c = input.charCodeAt(pos++);
      const digit =
        c >= 0x30 && c <= 0x39
          ? c - 22
          : c >= 0x61 && c <= 0x7a
            ? c - 0x61
            : c >= 0x41 && c <= 0x5a
              ? c - 0x41
              : BASE;
      if (digit >= BASE) return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      if (i > 0x10ffff * BASE) return null;
    }
    const len = out.length + 1;
    bias = adapt(i - old, len, old === 0);
    n += Math.floor(i / len);
    i %= len;
    if (n > 0x10ffff) return null;
    out.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...out);
}

/**
 * True when `label` imitates `brand`: a confusable swap (`paypa1`, `rnicrosoft`, Cyrillic
 * `pаypal` as punycode) or a doubled letter. Plain one-letter differences don't count: on the
 * Tranco top 100k they hit real banks and shops (`isbank`, `paypay`); neither does the brand's
 * own label on another suffix (that is brandKeyword's job, at lower weight).
 */
function imitates(label: string, brand: string): boolean {
  if (label.startsWith("xn--")) {
    const decoded = decodePunycode(label.slice(4));
    return decoded !== null && fold(decoded) === brand;
  }
  return label !== brand && (fold(label) === brand || doubledLetter(label, brand));
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
  // Per brand: PayPal phish on Google Sites is still a PayPal claim; only the owner is skipped.
  const owner = brands?.ownerOf(host);
  const candidates = contextFree(brands).filter((b) => b !== owner);

  const label = site ? siteLabel(site) : "";
  const lookalike = candidates.some((b) =>
    b.domains.some((d) => {
      const brandLabel = d.split(".")[0] ?? "";
      return brandLabel.length >= MIN_LOOKALIKE && imitates(label, brandLabel);
    }),
  );

  // Host words the site chose: on a path-shared platform (`contoso.sharepoint.com`) only the
  // labels below the platform's domain; on a tenant platform the tenant label (`x.github.io`
  // has suffix `github.io`); on a bare public suffix, none.
  const below = site && host !== site ? host.slice(0, -site.length - 1).split(".") : [];
  const suffix = publicSuffix(host);
  const hostWords = !site
    ? ""
    : shared.isListed(host) && !shared.isTenant(host)
      ? below.join(".")
      : suffix && host.endsWith(`.${suffix}`)
        ? host.slice(0, -suffix.length - 1)
        : host;
  const words = (text: string) => text.split(/[./_-]+/).filter(Boolean);
  const pathTokens = new Set(words(url.path.toLowerCase()));
  // On a brand's own site the subdomain is a tenant name the brand assigned to a customer
  // (`spotify.okta.com`), so only the path can carry another brand's name there.
  const tokens = owner ? pathTokens : new Set([...words(hostWords), ...pathTokens]);
  const brandKeyword = candidates.some((b) =>
    b.aliases.some((a) => a.length >= MIN_KEYWORD && /^[a-z0-9]+$/.test(a) && tokens.has(a)),
  );

  const depth = below[0] === "www" ? below.length - 1 : below.length;

  return {
    lookalike,
    brandKeyword,
    ipHost: false,
    tenantPlatform: shared.isTenant(host),
    deepSubdomain: depth >= 4,
  };
}
