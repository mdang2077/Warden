/**
 * Sites the user chose to trust: permanent, local (chrome.storage.local), and keyed on the
 * site (registrable domain) like the popup's per-site settings. Trust means Stage 2 never
 * flags the site (and later never warns). It deliberately does NOT feed Stage 0's user
 * domains: that would make Stage 1 skip the phishing lists, and a page could then talk a
 * user into trusting it for good. List blocks keep their per-URL "Proceed anyway" instead.
 */
import type { KeyValueArea } from "./overrides.ts";
import { siteKey } from "./popup-prefs.ts";

export const TRUSTED_KEY = "trusted_sites";
const SITE = /^[a-z0-9.-]+$/;

type Stored = Record<string, number>;

async function readStored(area: KeyValueArea): Promise<Stored> {
  const raw = (await area.get(TRUSTED_KEY))[TRUSTED_KEY];
  const out: Stored = {};
  if (raw && typeof raw === "object") {
    for (const [site, at] of Object.entries(raw as Record<string, unknown>)) {
      if (SITE.test(site) && typeof at === "number") out[site] = at;
    }
  }
  return out;
}

/** A page URL (keyed via siteKey) or an already-keyed site from the trusted list. */
function keyOf(urlOrSite: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(urlOrSite)) return siteKey(urlOrSite);
  return SITE.test(urlOrSite) ? urlOrSite : null;
}

export async function readTrusted(area: KeyValueArea): Promise<Set<string>> {
  return new Set(Object.keys(await readStored(area)));
}

export async function listTrusted(area: KeyValueArea): Promise<string[]> {
  return [...(await readTrusted(area))].sort();
}

export async function setTrusted(
  area: KeyValueArea,
  urlOrSite: string,
  trusted: boolean,
  now: () => number = Date.now,
): Promise<void> {
  const site = keyOf(urlOrSite);
  if (!site) return;
  const stored = await readStored(area);
  if (trusted) stored[site] = now();
  else delete stored[site];
  await area.set({ [TRUSTED_KEY]: stored });
}
