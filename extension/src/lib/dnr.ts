/**
 * Compiles Tier A feed entries into declarativeNetRequest dynamic rules, so a known phish
 * is stopped before its request is sent.
 *
 * Rules use the `block` action, not `redirect`: a urlFilter redirect can't carry the
 * visited URL into `warning.html?u=…`, and Chrome caps redirect rules at 5,000. The
 * service worker sees the same navigation and shows the interstitial with the real URL.
 *
 * Matching mirrors docs/fp-policy.md §6:
 * - bare host (`host/`)            → `||host/`         host and subdomains
 * - path prefix (`host/dir/`)      → `||host/dir/`     everything under the prefix
 * - exact path (`host/a`)          → `||host/a|`, `||host/a?`  the path with any query
 * - exact path + query             → `||host/a?q|`
 * - IP literals: exact host only (`|http*://ip…`).
 * - shared hosts: exact host and exact path only; bare-host entries are never compiled.
 */
import { canonicalize, parseIPv4 } from "@warden/shared/canonicalize";
import { isEntryAllowed, type SharedHostList } from "@warden/shared/shared-hosts";
import type { FeedId } from "@warden/shared/types";

/** The subset of chrome.declarativeNetRequest.Rule this module produces. */
export interface DnrRule {
  id: number;
  priority: number;
  action: { type: "block" | "allow" };
  condition: {
    urlFilter: string;
    isUrlFilterCaseSensitive: true;
    resourceTypes: ["main_frame"];
  };
}

export interface DnrEntry {
  /** Canonical entry expression: host + path [+ ?query], no scheme. */
  expression: string;
  feed: FeedId;
}

/** Chrome's guaranteed minimum for dynamic rules (MAX_NUMBER_OF_DYNAMIC_RULES). */
export const MAX_DYNAMIC_RULES = 30_000;
export const BLOCK_PRIORITY = 1;
/** Session bypass rules outrank every block rule. */
export const BYPASS_PRIORITY = 2;

/** Characters with meaning in urlFilter syntax. Entries containing them are left to the worker. */
const FILTER_SYNTAX = /[*^|]/;

export interface CompileResult {
  rules: DnrRule[];
  /** Entries left to the service worker: unsafe characters, rejected, or over the cap. */
  skipped: number;
}

export function compileDnrRules(
  entries: readonly DnrEntry[],
  shared: SharedHostList,
  maxRules = MAX_DYNAMIC_RULES,
): CompileResult {
  const filters = new Set<string>();
  let skipped = 0;

  for (const { expression } of entries) {
    const entryFilters = filtersFor(expression, shared);
    if (!entryFilters || filters.size + entryFilters.length > maxRules) {
      skipped++;
      continue;
    }
    for (const f of entryFilters) filters.add(f);
  }

  const rules = [...filters].map((urlFilter, i) => rule(i + 1, BLOCK_PRIORITY, "block", urlFilter));
  return { rules, skipped };
}

function filtersFor(expression: string, shared: SharedHostList): string[] | null {
  if (FILTER_SYNTAX.test(expression)) return null;
  const url = canonicalize(`http://${expression}`);
  if (!url || url.host.includes("%")) return null;
  // The expression must already be canonical, or the rule could match something else.
  const roundTrip = url.host + url.path + (url.query === null ? "" : `?${url.query}`);
  if (roundTrip !== expression) return null;
  if (!isEntryAllowed(url, shared)) return null;

  const sharedHost = shared.isShared(url.host);
  // `||` would also match subdomains; shared hosts and IP literals need the exact host.
  const exactHost = sharedHost || parseIPv4(url.host) === url.host;
  const anchor = exactHost ? `|http*://${url.host}` : `||${url.host}`;
  const target = anchor + url.path;

  if (url.query !== null) return [`${target}?${url.query}|`];
  if (url.path.endsWith("/") && !sharedHost) return [target];
  return [`${target}|`, `${target}?`];
}

function rule(id: number, priority: number, type: "block" | "allow", urlFilter: string): DnrRule {
  return {
    id,
    priority,
    action: { type },
    condition: { urlFilter, isUrlFilterCaseSensitive: true, resourceTypes: ["main_frame"] },
  };
}

/** A session rule letting the user through to one exact URL after "Proceed anyway". */
export function bypassRule(id: number, rawUrl: string): DnrRule | null {
  const url = new URL(rawUrl);
  url.hash = "";
  if (FILTER_SYNTAX.test(url.href)) return null;
  return rule(id, BYPASS_PRIORITY, "allow", `|${url.href}|`);
}

/** The subset of chrome.declarativeNetRequest the sync needs. */
export interface DnrApi {
  getDynamicRules(): Promise<{ id: number }[]>;
  updateDynamicRules(options: { removeRuleIds: number[]; addRules: DnrRule[] }): Promise<void>;
}

/** Replaces every dynamic rule with `rules` in one atomic update. */
export async function replaceDynamicRules(api: DnrApi, rules: DnrRule[]): Promise<void> {
  const existing = await api.getDynamicRules();
  await api.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
}

/** The subset of chrome.declarativeNetRequest session-rule calls the bypass needs. */
export interface DnrSessionApi {
  getSessionRules(): Promise<{ id: number }[]>;
  updateSessionRules(options: { addRules: DnrRule[] }): Promise<void>;
}

/** Adds a session allow rule so DNR block rules don't stop a URL the user proceeded to. */
export async function addSessionBypass(api: DnrSessionApi, url: string): Promise<void> {
  const existing = await api.getSessionRules();
  const id = existing.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const rule = bypassRule(id, url);
  if (rule) await api.updateSessionRules({ addRules: [rule] });
}
