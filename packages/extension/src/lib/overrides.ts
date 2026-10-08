/**
 * Session-scoped "Proceed anyway" bypasses, kept in chrome.storage.session so they
 * vanish when the browser restarts. storage.session is only readable from extension
 * pages by default, so a web page can't plant a bypass for itself.
 *
 * A bypass records the sources the user saw on the interstitial when they clicked
 * through. It only hides a later block whose sources are all in that set, so a new
 * Safe Browsing hit is never hidden by a bypass the user granted for something else.
 */
import type { SourceId } from "@warden/shared/types";

/** The subset of chrome.storage.StorageArea the store needs. */
export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface Bypass {
  sources: SourceId[];
  grantedAt: number;
}

const PREFIX = "bypass:";

/** Bypasses are per exact URL. The fragment never reaches the server, so it's dropped. */
export function bypassKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  return PREFIX + url.href;
}

export function createOverrideStore(area: KeyValueArea, now: () => number = Date.now) {
  return {
    async addBypass(url: string, sources: readonly SourceId[]): Promise<void> {
      const key = bypassKey(url);
      const existing = (await area.get(key))[key] as Bypass | undefined;
      const merged = new Set([...(existing?.sources ?? []), ...sources]);
      const bypass: Bypass = { sources: [...merged], grantedAt: now() };
      await area.set({ [key]: bypass });
    },

    /** True only when the user already clicked through every one of `sources` for this URL. */
    async isBypassed(url: string, sources: readonly SourceId[]): Promise<boolean> {
      if (sources.length === 0) return false;
      const key = bypassKey(url);
      const bypass = (await area.get(key))[key] as Bypass | undefined;
      if (!bypass) return false;
      return sources.every((s) => bypass.sources.includes(s));
    },
  };
}

export type OverrideStore = ReturnType<typeof createOverrideStore>;
