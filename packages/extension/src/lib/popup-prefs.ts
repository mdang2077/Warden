/**
 * The toolbar popup's settings: two global toggles and a per-site popup mode. Kept in
 * chrome.storage.local (they persist across restarts); the background listens for
 * changes and rebuilds the affected DNR rules immediately.
 *
 * Sites are keyed on the registrable domain of the page the user is on, never on where a
 * popup goes: "Allow popups on this site" is about this site's behavior.
 */
import { registrableDomain } from "@warden/shared/psl";
import { shouldEvaluate } from "./navigation.ts";
import type { KeyValueArea } from "./overrides.ts";

export type SiteMode = "allow" | "standard" | "strict";

export interface PopupPrefs {
  phishing: boolean;
  hijack: boolean;
  /** "standard" is the default and is never stored. */
  sites: Record<string, "allow" | "strict">;
}

export const PREFS_KEY = "popup_prefs";
export const DEFAULT_PREFS: PopupPrefs = { phishing: true, hijack: true, sites: {} };

/** The per-site key for a page, or null for pages Warden never evaluates. */
export function siteKey(rawUrl: string): string | null {
  if (!shouldEvaluate(rawUrl)) return null;
  const host = new URL(rawUrl).hostname;
  return registrableDomain(host) ?? host;
}

export function normalizePrefs(raw: unknown): PopupPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sites: PopupPrefs["sites"] = {};
  if (r.sites && typeof r.sites === "object") {
    for (const [site, mode] of Object.entries(r.sites as Record<string, unknown>)) {
      if (mode === "allow" || mode === "strict") sites[site] = mode;
    }
  }
  return {
    phishing: typeof r.phishing === "boolean" ? r.phishing : DEFAULT_PREFS.phishing,
    hijack: typeof r.hijack === "boolean" ? r.hijack : DEFAULT_PREFS.hijack,
    sites,
  };
}

export async function readPrefs(area: KeyValueArea): Promise<PopupPrefs> {
  return normalizePrefs((await area.get(PREFS_KEY))[PREFS_KEY]);
}

export async function updatePrefs(
  area: KeyValueArea,
  change: (prefs: PopupPrefs) => PopupPrefs,
): Promise<PopupPrefs> {
  const next = normalizePrefs(change(await readPrefs(area)));
  await area.set({ [PREFS_KEY]: next });
  return next;
}

export function siteMode(prefs: PopupPrefs, site: string | null): SiteMode {
  return (site !== null && prefs.sites[site]) || "standard";
}

export function withSiteMode(prefs: PopupPrefs, site: string, mode: SiteMode): PopupPrefs {
  const sites = { ...prefs.sites };
  if (mode === "standard") delete sites[site];
  else sites[site] = mode;
  return { ...prefs, sites };
}

export function sitesWithMode(prefs: PopupPrefs, mode: "allow" | "strict"): string[] {
  return Object.keys(prefs.sites)
    .filter((site) => prefs.sites[site] === mode)
    .sort();
}

export function isStrict(prefs: PopupPrefs, site: string | null): boolean {
  return prefs.hijack && siteMode(prefs, site) === "strict";
}
