import { loadPopupNetworks } from "@warden/shared/popup-networks";
import { describe, expect, it, vi } from "vitest";
import { HIJACK_RULE_IDS } from "./dnr.ts";
import {
  compileHijackRules,
  DOMAINS_PER_RULE,
  installHijackRules,
  withUserBlocks,
} from "./hijack-rules.ts";
import { DEFAULT_PREFS, withBlocked, withSiteMode } from "./popup-prefs.ts";

const list = (domains: string[]) =>
  loadPopupNetworks({ version: 1, generatedAt: "", sources: [], domains });
const many = (n: number) => list(Array.from({ length: n }, (_, i) => `n${i}.popnet.example`));

describe("compileHijackRules", () => {
  it("blocks third-party page loads of listed domains, in the hijack id range", () => {
    const rules = compileHijackRules(list(["popads.net"]), DEFAULT_PREFS);
    expect(rules).toEqual([
      {
        id: HIJACK_RULE_IDS.first,
        priority: 1,
        action: { type: "block" },
        condition: {
          requestDomains: ["popads.net"],
          domainType: "thirdParty",
          resourceTypes: ["main_frame"],
        },
      },
    ]);
  });

  it("chunks domains across rules", () => {
    const rules = compileHijackRules(many(2 * DOMAINS_PER_RULE + 500), DEFAULT_PREFS);
    expect(rules.map((r) => r.id)).toEqual([29_900, 29_901, 29_902]);
    expect(rules.map((r) => r.condition.requestDomains.length)).toEqual([1_000, 1_000, 500]);
  });

  it("caps at the size of the hijack range", () => {
    const rules = compileHijackRules(many(101 * DOMAINS_PER_RULE), DEFAULT_PREFS);
    expect(rules).toHaveLength(100);
    expect(rules.at(-1)?.id).toBe(HIJACK_RULE_IDS.last);
  });

  it("exempts sites set to Allow, but not strict sites", () => {
    let prefs = withSiteMode(DEFAULT_PREFS, "b.example", "allow");
    prefs = withSiteMode(prefs, "a.example", "allow");
    prefs = withSiteMode(prefs, "s.example", "strict");
    const [rule] = compileHijackRules(list(["popads.net"]), prefs);
    expect(rule?.condition.excludedInitiatorDomains).toEqual(["a.example", "b.example"]);
  });

  it("omits IP sites from excludedInitiatorDomains (DNR takes domains only)", () => {
    const prefs = withSiteMode(DEFAULT_PREFS, "8.8.8.8", "allow");
    const [rule] = compileHijackRules(list(["popads.net"]), prefs);
    expect(rule?.condition).not.toHaveProperty("excludedInitiatorDomains");
  });

  it("produces no rules when popup blocking is off or the list is empty", () => {
    expect(compileHijackRules(list(["popads.net"]), { ...DEFAULT_PREFS, hijack: false })).toEqual(
      [],
    );
    expect(compileHijackRules(list([]), DEFAULT_PREFS)).toEqual([]);
  });
});

describe("installHijackRules", () => {
  it("replaces only the hijack range", async () => {
    const api = {
      getDynamicRules: vi.fn(async () => [{ id: 1 }, { id: 29_900 }]),
      updateDynamicRules: vi.fn(async () => {}),
    };
    const rules = compileHijackRules(list(["popads.net"]), DEFAULT_PREFS);
    await installHijackRules(api, rules);
    expect(api.updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [29_900],
      addRules: rules,
    });
  });
});

describe("withUserBlocks", () => {
  it("adds the user's blocked sites to the network list, subdomains included", () => {
    const prefs = withBlocked(DEFAULT_PREFS, "casino.example", true);
    const merged = withUserBlocks(list(["popads.net"]), prefs);
    expect(merged.domains).toEqual(["casino.example", "popads.net"]);
    expect(merged.has("www.casino.example")).toBe(true);
    expect(merged.has("popads.net")).toBe(true);
    expect(merged.has("example")).toBe(false);
    const rules = compileHijackRules(merged, prefs);
    expect(rules[0]?.condition.requestDomains).toEqual(["casino.example", "popads.net"]);
  });

  it("returns the list unchanged when nothing is blocked", () => {
    const l = list(["popads.net"]);
    expect(withUserBlocks(l, DEFAULT_PREFS)).toBe(l);
  });
});
