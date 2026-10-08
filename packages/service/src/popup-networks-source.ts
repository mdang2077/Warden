/**
 * Builds the popup-network list from EasyList's `$popup` filters, at most once a day,
 * merged with the curated list bundled in packages/shared/ (also the extension's fallback). The
 * last good list is kept in the store; if a refresh fails the old one stays in use.
 *
 * Only `||domain^$popup` (optionally `,third-party`) entries are kept: paths, wildcards,
 * `domain=` scoping, and exceptions can't be expressed as a DNR requestDomains rule.
 * EasyList's license and attribution terms: see packages/extension/public/THIRD_PARTY_NOTICES.txt.
 */
import {
  bundledPopupNetworksFile,
  DOMAIN_PATTERN,
  loadPopupNetworks,
  type PopupNetworksFile,
} from "@warden/shared/popup-networks";
import { registrableDomain } from "@warden/shared/psl";
import { type BlobStore, getJson, putJson } from "./storage.ts";

export const EASYLIST_URL = "https://easylist.to/easylist/easylist.txt";
const REFRESH_MS = 24 * 60 * 60_000;
/** A truncated or wrong download would silently shrink the list. */
const MIN_EASYLIST_DOMAINS = 20;
const STATE_KEY = "state/popup-networks.json";

const RULE = /^\|\|([^/^*|$]+)\^\$([a-z0-9,-]+)$/;
const ALLOWED_OPTIONS = new Set(["popup", "third-party", "3p"]);

export function extractPopupDomains(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    const m = RULE.exec(raw.trim());
    if (!m) continue;
    const options = (m[2] as string).split(",");
    if (!options.includes("popup") || !options.every((o) => ALLOWED_OPTIONS.has(o))) continue;
    const domain = (m[1] as string).toLowerCase();
    if (!DOMAIN_PATTERN.test(domain) || registrableDomain(domain) === null) continue;
    out.add(domain);
  }
  return [...out].sort();
}

/**
 * Domains never published as pop networks, even when EasyList lists them: real sites or
 * link redirectors whose blocking would break ordinary clicks (Warden blocks same-tab loads
 * too, not only new windows). Each entry drops the domain and its subdomains. Review list:
 * packages/eval/reports/HIJACK_TRANCO.md (taskboard H4).
 */
export const POPUP_NETWORK_EXCLUDES: readonly string[] = [];

const excludedBy = (excludes: readonly string[]) => (domain: string) =>
  excludes.some((e) => domain === e || domain.endsWith(`.${e}`));

export function buildPopupNetworks(
  easylist: readonly string[],
  curated: readonly string[],
  now: number,
  excludes: readonly string[] = POPUP_NETWORK_EXCLUDES,
): PopupNetworksFile {
  const excluded = excludedBy(excludes);
  return {
    version: now,
    generatedAt: new Date(now).toISOString(),
    sources: [
      { name: "EasyList", license: "see THIRD_PARTY_NOTICES", url: "https://easylist.to/" },
      ...bundledPopupNetworksFile.sources,
    ],
    domains: [...new Set([...easylist, ...curated])].filter((d) => !excluded(d)).sort(),
  };
}

interface PopupNetworksState {
  fetchedAt: number;
  file: PopupNetworksFile;
}

export async function refreshPopupNetworks(
  store: BlobStore,
  fetchFn: typeof fetch,
  now: number,
): Promise<{ file: PopupNetworksFile | null; refreshed: boolean; error?: string }> {
  const state = await getJson<PopupNetworksState>(store, STATE_KEY);
  if (state && now - state.fetchedAt < REFRESH_MS) return { file: state.file, refreshed: false };

  try {
    const res = await fetchFn(EASYLIST_URL);
    if (!res.ok) throw new Error(`easylist returned ${res.status}`);
    const easylist = extractPopupDomains(await res.text());
    if (easylist.length < MIN_EASYLIST_DOMAINS) {
      throw new Error(`easylist has too few popup domains: ${easylist.length}`);
    }
    const file = buildPopupNetworks(easylist, bundledPopupNetworksFile.domains, now);
    loadPopupNetworks(file); // throws on anything the extension would reject
    await putJson(store, STATE_KEY, { fetchedAt: now, file });
    return { file, refreshed: true };
  } catch (err) {
    return {
      file: state?.file ?? null,
      refreshed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
