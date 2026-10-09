/**
 * Whether Safe Browsing lookups are working, for the popup's "protection reduced" note. When
 * the proxy is over its budget or unreachable, lookups fail open (no block), so without this
 * note the user would never know protection had dropped to Warden's own lists.
 *
 * Stored in chrome.storage.session, written only when the state changes (not per lookup).
 */
import type { CanonicalUrl } from "@warden/shared/canonicalize";
import type { SafeBrowsing } from "@warden/shared/stage1";
import type { KeyValueArea } from "./overrides.ts";

export interface SbHealth {
  lastOkAt: number | null;
  lastErrorAt: number | null;
}

const KEY = "sb_health";
/** A failure older than this (with no lookup since) no longer says anything. */
export const DEGRADED_WINDOW_MS = 15 * 60_000;

export async function readSbHealth(area: KeyValueArea): Promise<SbHealth> {
  const stored = (await area.get(KEY))[KEY] as Partial<SbHealth> | undefined;
  return { lastOkAt: stored?.lastOkAt ?? null, lastErrorAt: stored?.lastErrorAt ?? null };
}

export function sbDegraded(health: SbHealth, now: number): boolean {
  const { lastOkAt, lastErrorAt } = health;
  if (lastErrorAt === null || now - lastErrorAt > DEGRADED_WINDOW_MS) return false;
  return lastOkAt === null || lastErrorAt > lastOkAt;
}

export function withHealthTracking(
  client: SafeBrowsing,
  area: KeyValueArea,
  now: () => number = Date.now,
): SafeBrowsing {
  let health: SbHealth = { lastOkAt: null, lastErrorAt: null };
  let lastState: "ok" | "error" | null = null;
  return {
    async check(url: CanonicalUrl) {
      const verdict = await client.check(url);
      const state = verdict.error ? "error" : "ok";
      // Every failure is recorded (they're rare and their time matters); a success only
      // when it ends a failure or is the first one.
      if (state === "error" || state !== lastState) {
        health =
          state === "error" ? { ...health, lastErrorAt: now() } : { ...health, lastOkAt: now() };
        lastState = state;
        await area.set({ [KEY]: health }).catch(() => {});
      }
      return verdict;
    },
  };
}
