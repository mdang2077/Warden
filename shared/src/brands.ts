/**
 * Protected brands for the Stage 2 brand–domain mismatch signal (S2.6): each brand's names
 * and the registrable domains it really owns (main, sign-in, regional, asset/CDN). A page
 * claiming a brand on any other domain is a mismatch.
 *
 * Validation here is structural only, so the content script needn't bundle the PSL; the
 * "every domain is registrable" check lives in brands.test.ts.
 */
import bundled from "./brands.json" with { type: "json" };

export interface Brand {
  id: string;
  name: string;
  /** Lowercase; matched as whole words after normalizeText. */
  aliases: string[];
  domains: string[];
  /** Short or common-word names: only count in a title/heading next to a login word. */
  needsContext?: boolean;
}

export interface BrandsFile {
  version: number;
  brands: Brand[];
}

export interface BrandList {
  version: number;
  brands: readonly Brand[];
  byId(id: string): Brand | undefined;
  /** The brand owning `host` (equal to or under one of its domains). */
  ownerOf(host: string): Brand | undefined;
}

const ID = /^[a-z0-9_]+$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function loadBrands(file: BrandsFile): BrandList {
  if (!Number.isInteger(file.version) || file.version < 1) {
    throw new Error(`brands: bad version ${file.version}`);
  }
  const ids = new Map<string, Brand>();
  const owners = new Map<string, Brand>();
  for (const b of file.brands) {
    if (!ID.test(b.id) || ids.has(b.id)) throw new Error(`brands: bad or duplicate id ${b.id}`);
    if (!b.name) throw new Error(`brands: ${b.id} has no name`);
    if (!b.aliases.length || b.aliases.some((a) => !a || a !== a.trim().toLowerCase())) {
      throw new Error(`brands: ${b.id} aliases must be non-empty, trimmed, lowercase`);
    }
    if (!b.domains.length) throw new Error(`brands: ${b.id} has no domains`);
    for (const d of b.domains) {
      if (!DOMAIN.test(d)) throw new Error(`brands: ${b.id} bad domain ${d}`);
      const other = owners.get(d);
      if (other) throw new Error(`brands: ${d} owned by both ${other.id} and ${b.id}`);
      owners.set(d, b);
    }
    ids.set(b.id, b);
  }
  return {
    version: file.version,
    brands: [...ids.values()],
    byId: (id) => ids.get(id),
    ownerOf(host) {
      // Check the host, then each suffix after a dot: a.b.paypal.com → b.paypal.com → paypal.com → com.
      let suffix = host.toLowerCase().replace(/\.$/, "");
      for (;;) {
        const owner = owners.get(suffix);
        if (owner) return owner;
        const dot = suffix.indexOf(".");
        if (dot === -1) return undefined;
        suffix = suffix.slice(dot + 1);
      }
    },
  };
}

export const bundledBrandsFile: BrandsFile = bundled;

function loadBundled(): BrandList | null {
  try {
    return loadBrands(bundledBrandsFile);
  } catch (err) {
    console.error("[Warden] brands.json invalid; brand signal disabled", err);
    return null;
  }
}

export const bundledBrands: BrandList | null = loadBundled();
