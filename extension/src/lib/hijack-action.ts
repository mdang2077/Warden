/**
 * What Warden does once a popup or redirect is judged a hijack, by a DNR block on a pop
 * network (Standard) or by strict mode: close a new tab that a page opened, or send a
 * redirected tab back. Nothing is shown in the page; each block is recorded per tab in
 * chrome.storage.session for the toolbar badge and the popup.
 *
 * Opener records live in storage.session too (plus an in-memory copy, because the new
 * tab's first navigation can race the storage write), so a worker restart between "a
 * page opened a tab" and "that tab hit a pop network" still closes the tab.
 */
import type { KeyValueArea } from "./overrides.ts";
import { siteKey } from "./popup-prefs.ts";

export type HijackLayer = "standard" | "strict";

export interface HijackBlock {
  destinationHost: string;
  kind: "new-tab" | "redirect";
  layer: HijackLayer;
  at: number;
}

export interface TabHijackRecord {
  /** The site the counts belong to; reset when the tab moves to another site. */
  siteKey: string | null;
  blocks: HijackBlock[];
}

export interface OpenerRecord {
  sourceTabId: number;
  at: number;
}

export const MAX_BLOCKS = 20;
export const LOOP_LIMIT = 3;
export const LOOP_WINDOW_MS = 10_000;
/** Muted gray: red stays reserved for phishing. */
export const BADGE_COLOR = "#6b6b6b";

type SessionArea = KeyValueArea & { remove(key: string): Promise<void> };

const recordKey = (tabId: number) => `hijack:${tabId}`;
const openerKey = (tabId: number) => `opener:${tabId}`;

export async function getHijackRecord(
  area: KeyValueArea,
  tabId: number,
): Promise<TabHijackRecord | null> {
  const key = recordKey(tabId);
  return ((await area.get(key))[key] as TabHijackRecord | undefined) ?? null;
}

export interface HijackDeps {
  area: SessionArea;
  tabs: { remove(tabId: number): Promise<void>; goBack(tabId: number): Promise<void> };
  badge: {
    setBadgeText(details: { tabId: number; text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { tabId: number; color: string }): Promise<void>;
  };
  now?: () => number;
}

export type HijackOutcome = "closed" | "went-back" | "left";

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export function createHijackAction(deps: HijackDeps) {
  const now = deps.now ?? Date.now;
  const openers = new Map<number, OpenerRecord>();
  const backs = new Map<number, number[]>();

  /** The tab may already be gone (closed by the user or another extension). */
  const quietly = async (call: () => Promise<unknown>) => {
    try {
      await call();
    } catch {
      // nothing to do
    }
  };

  const showBadge = async (tabId: number, count: number) => {
    await quietly(() => deps.badge.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }));
    await quietly(() => deps.badge.setBadgeText({ tabId, text: count > 0 ? String(count) : "" }));
  };

  const addBlock = async (tabId: number, block: HijackBlock) => {
    const record = (await getHijackRecord(deps.area, tabId)) ?? { siteKey: null, blocks: [] };
    record.blocks = [...record.blocks, block].slice(-MAX_BLOCKS);
    await deps.area.set({ [recordKey(tabId)]: record });
    await showBadge(tabId, record.blocks.length);
  };

  const openerOf = async (tabId: number): Promise<OpenerRecord | null> => {
    const cached = openers.get(tabId);
    if (cached) return cached;
    const key = openerKey(tabId);
    return ((await deps.area.get(key))[key] as OpenerRecord | undefined) ?? null;
  };

  const clearOpener = async (tabId: number) => {
    openers.delete(tabId);
    await deps.area.remove(openerKey(tabId));
  };

  return {
    async recordOpener(tabId: number, sourceTabId: number): Promise<void> {
      const record = { sourceTabId, at: now() };
      openers.set(tabId, record);
      await deps.area.set({ [openerKey(tabId)]: record });
    },

    openerOf,

    async handle(ev: { tabId: number; url: string; layer: HijackLayer }): Promise<HijackOutcome> {
      const destinationHost = new URL(ev.url).hostname;
      const at = now();
      const opener = await openerOf(ev.tabId);
      if (opener) {
        await clearOpener(ev.tabId);
        await quietly(() => deps.tabs.remove(ev.tabId));
        await addBlock(opener.sourceTabId, {
          destinationHost,
          kind: "new-tab",
          layer: ev.layer,
          at,
        });
        return "closed";
      }

      await addBlock(ev.tabId, { destinationHost, kind: "redirect", layer: ev.layer, at });
      const recent = (backs.get(ev.tabId) ?? []).filter((t) => at - t < LOOP_WINDOW_MS);
      if (recent.length >= LOOP_LIMIT) {
        backs.set(ev.tabId, recent);
        return "left";
      }
      backs.set(ev.tabId, [...recent, at]);
      try {
        await deps.tabs.goBack(ev.tabId);
        return "went-back";
      } catch {
        // No history to go back to: Chrome's blocked-page screen stays up.
        return "left";
      }
    },

    /** Call for every committed top-frame navigation that wasn't itself judged a hijack. */
    async onCommitted(tabId: number, url: string): Promise<void> {
      // window.open() commits about:blank before the real URL; the tab is still "new".
      if (!isWebUrl(url)) return;
      await clearOpener(tabId);
      const key = siteKey(url);
      const record = await getHijackRecord(deps.area, tabId);
      const keep = record && (record.siteKey === key || record.siteKey === null);
      const next: TabHijackRecord = { siteKey: key, blocks: keep ? record.blocks : [] };
      await deps.area.set({ [recordKey(tabId)]: next });
      // Chrome may clear per-tab badge text on navigation, so it's always reapplied.
      await showBadge(tabId, next.blocks.length);
    },

    async forgetTab(tabId: number): Promise<void> {
      openers.delete(tabId);
      backs.delete(tabId);
      await deps.area.remove(openerKey(tabId));
      await deps.area.remove(recordKey(tabId));
    },
  };
}

export type HijackAction = ReturnType<typeof createHijackAction>;
