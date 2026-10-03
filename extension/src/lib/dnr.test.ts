import { bundledSharedHosts as shared } from "@warden/shared/shared-hosts";
import { describe, expect, it, vi } from "vitest";
import {
  addSessionBypass,
  BYPASS_PRIORITY,
  bypassRule,
  compileDnrRules,
  type DnrEntry,
  type DnrRule,
  replaceDynamicRules,
} from "./dnr.ts";

/**
 * Minimal emulation of Chrome's urlFilter syntax: `||` domain anchor, `|` start/end
 * anchor, `*` wildcard, `^` separator. Case-sensitive, as the rules request.
 */
function urlFilterMatches(filter: string, url: string): boolean {
  let f = filter;
  let re = "";
  if (f.startsWith("||")) {
    re = "^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?";
    f = f.slice(2);
  } else if (f.startsWith("|")) {
    re = "^";
    f = f.slice(1);
  }
  const endAnchor = f.endsWith("|");
  if (endAnchor) f = f.slice(0, -1);
  for (const ch of f) {
    if (ch === "*") re += ".*";
    else if (ch === "^") re += "(?:[^a-zA-Z0-9_.%-]|$)";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  if (endAnchor) re += "$";
  return new RegExp(re).test(url);
}

function blocks(rules: DnrRule[], url: string): boolean {
  return rules.some(
    (r) => r.action.type === "block" && urlFilterMatches(r.condition.urlFilter, url),
  );
}

function compile(...expressions: string[]) {
  const entries: DnrEntry[] = expressions.map((expression) => ({ expression, feed: "openphish" }));
  return compileDnrRules(entries, shared);
}

describe("urlFilter emulation (sanity)", () => {
  it("follows Chrome's anchor semantics", () => {
    expect(urlFilterMatches("||a.example/", "https://x.a.example/p")).toBe(true);
    expect(urlFilterMatches("||a.example/", "https://notora.example/p")).toBe(false);
    expect(urlFilterMatches("||a.example/", "https://xa.example/p")).toBe(false);
    expect(urlFilterMatches("|http*://a.example/x|", "https://a.example/x")).toBe(true);
    expect(urlFilterMatches("|http*://a.example/x|", "https://b.a.example/x")).toBe(false);
  });
});

describe("compileDnrRules: normal hosts", () => {
  it("a bare-host entry blocks the host and its subdomains", () => {
    const { rules } = compile("evil.example/");
    expect(blocks(rules, "https://evil.example/")).toBe(true);
    expect(blocks(rules, "http://login.evil.example/a/b?c")).toBe(true);
    expect(blocks(rules, "https://notevil.example/")).toBe(false);
  });

  it("a path-prefix entry blocks only under the prefix", () => {
    const { rules } = compile("evil.example/kit/");
    expect(blocks(rules, "https://evil.example/kit/a.html")).toBe(true);
    expect(blocks(rules, "https://evil.example/kits/a.html")).toBe(false);
    expect(blocks(rules, "https://evil.example/")).toBe(false);
  });

  it("an exact entry blocks that path with any query, and nothing below it", () => {
    const { rules } = compile("evil.example/a.html");
    expect(blocks(rules, "https://evil.example/a.html")).toBe(true);
    expect(blocks(rules, "https://evil.example/a.html?x=1")).toBe(true);
    expect(blocks(rules, "https://evil.example/a.html/more")).toBe(false);
    expect(blocks(rules, "https://evil.example/a.htmlx")).toBe(false);
    expect(blocks(rules, "https://evil.example/")).toBe(false);
  });

  it("an entry with a query blocks only that query", () => {
    const { rules } = compile("evil.example/a?id=1");
    expect(blocks(rules, "https://evil.example/a?id=1")).toBe(true);
    expect(blocks(rules, "https://evil.example/a?id=12")).toBe(false);
    expect(blocks(rules, "https://evil.example/a")).toBe(false);
  });

  it("is case-sensitive in the path", () => {
    const { rules } = compile("evil.example/Login");
    expect(rules.every((r) => r.condition.isUrlFilterCaseSensitive)).toBe(true);
    expect(blocks(rules, "https://evil.example/login")).toBe(false);
  });

  it("IP literals match the exact host only", () => {
    const { rules } = compile("1.2.3.4/");
    expect(blocks(rules, "http://1.2.3.4/x")).toBe(true);
    expect(blocks(rules, "http://11.2.3.4/x")).toBe(false);
  });

  it("only targets top-frame navigations", () => {
    const { rules } = compile("evil.example/");
    expect(rules[0]?.condition.resourceTypes).toEqual(["main_frame"]);
  });
});

describe("FP acceptance: no host-level DNR rule on a shared host", () => {
  const SHARED_ENTRIES = [
    "docs.google.com/",
    "docs.google.com/forms/d/X/viewform",
    "docs.google.com/forms/d/",
    "evil.github.io/",
    "evil.github.io/login/",
    "storage.googleapis.com/bucket/phish.html",
    "bit.ly/",
    "bit.ly/abc123",
    "acct.blob.core.windows.net/c/x.html",
  ];
  const { rules } = compile(...SHARED_ENTRIES);

  it("never blocks the shared host itself or other tenants' content", () => {
    for (const url of [
      "https://docs.google.com/",
      "https://docs.google.com/forms/d/Y/viewform",
      "https://docs.google.com/forms/d/X/edit",
      "https://docs.google.com/forms/d/other",
      "https://good.github.io/",
      "https://evil.github.io/",
      "https://evil.github.io/login/other.html",
      "https://storage.googleapis.com/bucket/other.html",
      "https://bit.ly/zzz",
      "https://bit.ly/",
      "https://other.blob.core.windows.net/c/x.html",
      "https://a.docs.google.com/forms/d/X/viewform",
    ]) {
      expect(blocks(rules, url), url).toBe(false);
    }
  });

  it("still blocks the exact reported URLs", () => {
    expect(blocks(rules, "https://docs.google.com/forms/d/X/viewform?usp=sf")).toBe(true);
    expect(blocks(rules, "https://evil.github.io/login/")).toBe(true);
    expect(blocks(rules, "https://bit.ly/abc123")).toBe(true);
    expect(blocks(rules, "https://acct.blob.core.windows.net/c/x.html")).toBe(true);
  });

  it("no rule on a shared host uses the subdomain anchor", () => {
    const sharedRules = rules.filter((r) =>
      /docs\.google\.com|github\.io|googleapis|bit\.ly|windows\.net/.test(r.condition.urlFilter),
    );
    expect(sharedRules.length).toBeGreaterThan(0);
    for (const r of sharedRules) expect(r.condition.urlFilter.startsWith("||")).toBe(false);
  });
});

describe("compileDnrRules: safety and limits", () => {
  it("skips entries with urlFilter syntax or non-canonical form", () => {
    const { rules, skipped } = compile(
      "evil.example/a*b",
      "evil.example/a^b",
      "EVIL.example/",
      "evil.example/ok",
    );
    expect(skipped).toBe(3);
    expect(rules).toHaveLength(2);
  });

  it("dedupes and caps the rule count", () => {
    const entries = Array.from({ length: 10 }, (_, i) => `e${i}.example/a`);
    const { rules, skipped } = compileDnrRules(
      [...entries, entries[0] as string].map((expression) => ({ expression, feed: "openphish" })),
      shared,
      7,
    );
    expect(rules).toHaveLength(6);
    expect(skipped).toBe(8);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });
});

describe("bypass rule", () => {
  it("allows exactly one URL, ignoring the fragment, above block rules", () => {
    const rule = bypassRule(99, "https://evil.example/a.html?x=1#frag");
    expect(rule?.priority).toBe(BYPASS_PRIORITY);
    expect(rule?.action.type).toBe("allow");
    const filter = rule?.condition.urlFilter ?? "";
    expect(urlFilterMatches(filter, "https://evil.example/a.html?x=1")).toBe(true);
    expect(urlFilterMatches(filter, "https://evil.example/a.html?x=12")).toBe(false);
    expect(urlFilterMatches(filter, "https://evil.example/a.html")).toBe(false);
  });
});

describe("replaceDynamicRules", () => {
  it("removes all existing rules and adds the new ones in one call", async () => {
    const api = {
      getDynamicRules: vi.fn(async () => [{ id: 1 }, { id: 5 }]),
      updateDynamicRules: vi.fn(async () => {}),
    };
    const { rules } = compile("evil.example/");
    await replaceDynamicRules(api, rules);
    expect(api.updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [1, 5], addRules: rules });
  });
});

describe("addSessionBypass", () => {
  it("adds an allow rule with the next free session id", async () => {
    const api = {
      getSessionRules: vi.fn(async () => [{ id: 3 }, { id: 7 }]),
      updateSessionRules: vi.fn(async () => {}),
    };
    await addSessionBypass(api, "https://evil.example/a");
    expect(api.updateSessionRules).toHaveBeenCalledWith({
      addRules: [expect.objectContaining({ id: 8, action: { type: "allow" } })],
    });
  });
});
