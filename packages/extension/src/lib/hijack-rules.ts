/**
 * Compiles the popup-network list into DNR block rules (the hijack guard's Standard
 * layer). A rule blocks a page load (`main_frame`) of a listed domain only when another
 * site started it (`domainType: "thirdParty"`): a URL the user types has no initiator
 * and loads. Sites the user set to "Allow" go in `excludedInitiatorDomains`, so the
 * browser applies the exception without the service worker.
 *
 * The phishing allowlist is deliberately not an input here.
 */
import { loadPopupNetworks, type PopupNetworkList } from "@warden/shared/popup-networks";
import { registrableDomain } from "@warden/shared/psl";
import { type DnrApi, HIJACK_RULE_IDS, replaceRuleRange } from "./dnr.ts";
import { type PopupPrefs, sitesWithMode } from "./popup-prefs.ts";

/** Same as the phishing block rules; below BYPASS_PRIORITY, so a session bypass still wins. */
export const HIJACK_PRIORITY = 1;
export const DOMAINS_PER_RULE = 1_000;

export interface HijackRule {
  id: number;
  priority: number;
  action: { type: "block" };
  condition: {
    requestDomains: string[];
    excludedInitiatorDomains?: string[];
    domainType: "thirdParty";
    resourceTypes: ["main_frame"];
  };
}

/**
 * The network list plus the user's own blocked sites (popup "Block when other sites open
 * this"), so they get the same blocking, close-or-go-back, and typed-address exception.
 */
export function withUserBlocks(list: PopupNetworkList, prefs: PopupPrefs): PopupNetworkList {
  if (prefs.blocked.length === 0) return list;
  return loadPopupNetworks({
    version: list.version,
    generatedAt: "",
    sources: [],
    domains: [...list.domains, ...prefs.blocked],
  });
}

export function compileHijackRules(list: PopupNetworkList, prefs: PopupPrefs): HijackRule[] {
  if (!prefs.hijack) return [];
  // IP sites can't be expressed as initiator domains; they stay on Standard.
  const allowed = sitesWithMode(prefs, "allow").filter((s) => registrableDomain(s) !== null);
  const maxRules = HIJACK_RULE_IDS.last - HIJACK_RULE_IDS.first + 1;
  const rules: HijackRule[] = [];
  for (let i = 0; i < list.domains.length && rules.length < maxRules; i += DOMAINS_PER_RULE) {
    rules.push({
      id: HIJACK_RULE_IDS.first + rules.length,
      priority: HIJACK_PRIORITY,
      action: { type: "block" },
      condition: {
        requestDomains: list.domains.slice(i, i + DOMAINS_PER_RULE),
        ...(allowed.length > 0 ? { excludedInitiatorDomains: allowed } : {}),
        domainType: "thirdParty",
        resourceTypes: ["main_frame"],
      },
    });
  }
  return rules;
}

export function installHijackRules(api: DnrApi, rules: readonly HijackRule[]): Promise<void> {
  return replaceRuleRange(api, HIJACK_RULE_IDS, rules);
}
