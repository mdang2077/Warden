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
 * - IP literals and parents of shared hosts: exact host only (`|http://ip…`, `|https://ip…`).
 * - shared hosts: exact host and exact path only; bare-host entries are never compiled.
 * - trusted hosts (allowlisted, or marked safe by the user) never get a rule: DNR runs
 *   before the service worker, so a rule there would override the allowlist.
 * - private-network and local-only hosts never get a rule (the worker never checks them).
 */
import { canonicalize, parseIPv4 } from "@warden/shared/canonicalize";
import { sha256 } from "@warden/shared/expressions";
import { isEntryAllowed, type SharedHostList } from "@warden/shared/shared-hosts";
import type { FeedId } from "@warden/shared/types";
import { shouldEvaluate } from "./navigation.ts";

/** The subset of chrome.declarativeNetRequest.Rule this module produces. */
export interface DnrRule {
  id: number;
  priority: number;
  action: { type: "block" | "allow" };
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    isUrlFilterCaseSensitive: true;
    resourceTypes: ["main_frame"];
    /** Session rules only: limit the rule to these tabs. */
    tabIds?: number[];
  };
}

export interface DnrEntry {
  /** Canonical entry expression: host + path [+ ?query], no scheme. */
  expression: string;
  feed: FeedId;
}

/** Chrome's guaranteed minimum for dynamic rules (MAX_NUMBER_OF_DYNAMIC_RULES). */
export const MAX_DYNAMIC_RULES = 30_000;

export interface RuleRange {
  first: number;
  last: number;
}

/**
 * Dynamic rule ids are split so each compiler replaces only its own rules. The phishing
 * rules give up the top 100 ids to the hijack guard (packages/extension/src/lib/hijack-rules.ts).
 */
export const PHISHING_RULE_IDS: RuleRange = { first: 1, last: 29_899 };
export const HIJACK_RULE_IDS: RuleRange = { first: 29_900, last: 29_999 };
export const MAX_PHISHING_RULES = PHISHING_RULE_IDS.last - PHISHING_RULE_IDS.first + 1;
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

export interface CompileOptions {
  /** True for hosts the allowlist or the user trusts. Their entries are never compiled. */
  trusted?: (host: string) => boolean;
  maxRules?: number;
}

export function compileDnrRules(
  entries: readonly DnrEntry[],
  shared: SharedHostList,
  options: CompileOptions = {},
): CompileResult {
  const maxRules = options.maxRules ?? MAX_PHISHING_RULES;
  const trusted = options.trusted ?? (() => false);
  const filters = new Set<string>();
  let skipped = 0;

  for (const { expression } of entries) {
    const entryFilters = filtersFor(expression, shared, trusted);
    if (!entryFilters || filters.size + entryFilters.length > maxRules) {
      skipped++;
      continue;
    }
    for (const f of entryFilters) filters.add(f);
  }

  const rules = [...filters].map((urlFilter, i) =>
    rule(i + 1, BLOCK_PRIORITY, "block", { urlFilter }),
  );
  return { rules, skipped };
}

function filtersFor(
  expression: string,
  shared: SharedHostList,
  trusted: (host: string) => boolean,
): string[] | null {
  if (FILTER_SYNTAX.test(expression)) return null;
  const url = canonicalize(`http://${expression}`);
  if (!url || url.host.includes("%")) return null;
  // The expression must already be canonical, or the rule could match something else.
  const roundTrip = url.host + url.path + (url.query === null ? "" : `?${url.query}`);
  if (roundTrip !== expression) return null;
  if (!isEntryAllowed(url, shared) || trusted(url.host)) return null;
  // The worker never evaluates private-network or local-only hosts, so the
  // ERR_BLOCKED_BY_CLIENT fallback could never undo a rule on one (e.g. a router page).
  if (!shouldEvaluate(`http://${url.host}/`)) return null;

  const sharedHost = shared.isShared(url.host);
  // `||` would also match subdomains, so shared hosts, parents of shared hosts (an entry on
  // `googleapis.com` must not reach `storage.googleapis.com`), and IP literals need the
  // exact host. Not `|http*://host`: the `*` can span another site's URL that merely
  // contains this one, e.g. `https://archive.example/web/https://host/path`.
  const exactHost =
    sharedHost || shared.hasSharedBelow(url.host) || parseIPv4(url.host) === url.host;
  const anchors = exactHost ? [`|http://${url.host}`, `|https://${url.host}`] : [`||${url.host}`];

  return anchors.flatMap((anchor) => {
    const target = anchor + url.path;
    if (url.query !== null) return [`${target}?${url.query}|`];
    if (url.path.endsWith("/") && !sharedHost) return [target];
    return [`${target}|`, `${target}?`];
  });
}

function rule(
  id: number,
  priority: number,
  type: "block" | "allow",
  filter: { urlFilter: string } | { regexFilter: string },
): DnrRule {
  return {
    id,
    priority,
    action: { type },
    condition: { ...filter, isUrlFilterCaseSensitive: true, resourceTypes: ["main_frame"] },
  };
}

/**
 * A session rule letting the user through to one exact URL after "Proceed anyway". URLs
 * containing urlFilter syntax (`*`, `^`, `|`) use an escaped regexFilter instead.
 */
export function bypassRule(id: number, rawUrl: string): DnrRule {
  const url = new URL(rawUrl);
  url.hash = "";
  const filter = FILTER_SYNTAX.test(url.href)
    ? { regexFilter: `^${url.href.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&")}$` }
    : { urlFilter: `|${url.href}|` };
  return rule(id, BYPASS_PRIORITY, "allow", filter);
}

/** Session rule id for a URL: stable, so concurrent bypasses of one URL write one rule. */
export async function bypassRuleId(rawUrl: string, scope = ""): Promise<number> {
  const url = new URL(rawUrl);
  url.hash = "";
  const h = await sha256(scope + url.href);
  // 30 bits, never 0: DNR rule ids must be positive integers.
  return (
    ((((h[0] as number) << 24) |
      ((h[1] as number) << 16) |
      ((h[2] as number) << 8) |
      (h[3] as number)) >>>
      2) +
    1
  );
}

/** Any rule this module installs; only the id matters for range bookkeeping. */
export interface DnrRuleLike {
  id: number;
}

/** The subset of chrome.declarativeNetRequest the sync needs. */
export interface DnrApi {
  getDynamicRules(): Promise<{ id: number }[]>;
  updateDynamicRules(options: { removeRuleIds: number[]; addRules: DnrRuleLike[] }): Promise<void>;
}

const inRange = (id: number, range: RuleRange) => id >= range.first && id <= range.last;

/** Replaces the dynamic rules in `range` with `rules`, in one atomic update. */
export async function replaceRuleRange(
  api: DnrApi,
  range: RuleRange,
  rules: readonly DnrRuleLike[],
): Promise<void> {
  const outside = rules.find((r) => !inRange(r.id, range));
  if (outside) throw new Error(`DNR rule id ${outside.id} outside ${range.first}..${range.last}`);
  const existing = await api.getDynamicRules();
  await api.updateDynamicRules({
    removeRuleIds: existing.filter((r) => inRange(r.id, range)).map((r) => r.id),
    addRules: [...rules],
  });
}

/** The subset of chrome.declarativeNetRequest session-rule calls the bypass needs. */
export interface DnrSessionApi {
  updateSessionRules(options: { removeRuleIds: number[]; addRules: DnrRule[] }): Promise<void>;
}

/**
 * Adds a session allow rule so DNR block rules don't stop one URL. Remove-then-add with
 * a URL-derived id is atomic and idempotent, so two tabs bypassing at once can't collide.
 */
export async function addSessionBypass(api: DnrSessionApi, url: string): Promise<void> {
  const id = await bypassRuleId(url);
  await api.updateSessionRules({ removeRuleIds: [id], addRules: [bypassRule(id, url)] });
}

/**
 * Lets one tab through to one exact URL: for a site the user opened themselves (typed, a
 * bookmark) that a hijack-guard rule blocks. Unlike the session bypass it must not let
 * other sites open the URL later, so it is limited to the tab and the caller removes it
 * once the visit has loaded. Returns the rule id.
 */
export async function addTabBypass(
  api: DnrSessionApi,
  url: string,
  tabId: number,
): Promise<number> {
  const id = await bypassRuleId(url, `tab:${tabId}:`);
  const base = bypassRule(id, url);
  const rule: DnrRule = { ...base, condition: { ...base.condition, tabIds: [tabId] } };
  await api.updateSessionRules({ removeRuleIds: [id], addRules: [rule] });
  return id;
}
