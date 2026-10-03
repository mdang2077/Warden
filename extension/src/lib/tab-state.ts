/**
 * Last cascade outcome per tab, for the popup. Kept in chrome.storage.session because
 * the MV3 service worker can be stopped at any time and loses in-memory state.
 */
import type { Decision, SourceId } from "@warden/shared/types";
import type { KeyValueArea } from "./overrides.ts";

export interface TabVerdict {
  url: string;
  decision: Decision;
  sources: SourceId[];
  /** True when the user had already clicked through this block. */
  bypassed: boolean;
  at: number;
}

const key = (tabId: number) => `tab:${tabId}`;

export async function setTabVerdict(
  area: KeyValueArea,
  tabId: number,
  verdict: TabVerdict,
): Promise<void> {
  await area.set({ [key(tabId)]: verdict });
}

export async function getTabVerdict(area: KeyValueArea, tabId: number): Promise<TabVerdict | null> {
  return ((await area.get(key(tabId)))[key(tabId)] as TabVerdict | undefined) ?? null;
}

export async function clearTabVerdict(
  area: KeyValueArea & { remove(key: string): Promise<void> },
  tabId: number,
): Promise<void> {
  await area.remove(key(tabId));
}
