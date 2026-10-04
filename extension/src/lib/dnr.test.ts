import { bundledSharedHosts as shared } from "@warden/shared/shared-hosts";
import { describe, expect, it, vi } from "vitest";
import {
  addSessionBypass,
  BYPASS_PRIORITY,
  bypassRule,
  bypassRuleId,
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
    (r) => r.action.type === "block" && urlFilterMatches(r.condition.urlFilter ?? "", url),
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

  it("never compiles private-network or local-only hosts", () => {
    // The worker never evaluates these, so the ERR_BLOCKED_BY_CLIENT fallback can't undo them.
    const { rules, skipped } = compile(
      "192.168.1.1/",
      "10.0.0.1/admin",
      "router.lan/",
      "printer.local/",
      "nas.home.arpa/x",
    );
    expect(rules).toEqual([]);
    expect(skipped).toBe(5);
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
    "github.io/",
    "www.github.io/",
    "pages.dev/login",
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
      "https://github.io/",
      "https://www.github.io/",
      "https://x.pages.dev/login",
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

  it("never blocks a page that merely contains a reported URL in its path or query", () => {
    // Checked against real Chromium: `|http*://host…` let `*` span another site's URL.
    for (const url of [
      "https://web.archive.org/web/2024/https://docs.google.com/forms/d/X/viewform",
      "https://share.example/?u=https://docs.google.com/forms/d/X/viewform?usp=sf",
      "https://scanner.example/check?url=http://bit.ly/abc123",
    ]) {
      expect(blocks(rules, url), url).toBe(false);
    }
    const ip = compile("1.2.3.4/a").rules;
    expect(blocks(ip, "https://ok.example/?u=http://1.2.3.4/a")).toBe(false);
    expect(blocks(ip, "https://1.2.3.4/a")).toBe(true);
  });

  it("a bare tenant entry blocks that tenant only", () => {
    const tenant = compile("evil.github.io/").rules;
    expect(blocks(tenant, "https://evil.github.io/login")).toBe(true);
    expect(blocks(tenant, "https://a.evil.github.io/")).toBe(true);
    expect(blocks(tenant, "https://good.github.io/")).toBe(false);
    expect(blocks(tenant, "https://github.io/")).toBe(false);
  });

  it("an entry on a parent of a shared host never matches the shared host", () => {
    const parents = compile("core.windows.net/", "googleapis.com/", "googleapis.com/login/").rules;
    for (const url of [
      "https://acct.blob.core.windows.net/c/x.html",
      "https://storage.googleapis.com/bucket/x.html",
      "https://firebasestorage.googleapis.com/login/x",
    ]) {
      expect(blocks(parents, url), url).toBe(false);
    }
    expect(blocks(parents, "https://core.windows.net/x")).toBe(true);
    // googleapis.com is itself a public suffix (PSL private section), so it gets no rule.
    expect(blocks(parents, "https://googleapis.com/login/x")).toBe(false);
  });

  it("no rule on a shared host uses the subdomain anchor", () => {
    // evil.github.io is a tenant, so its own rules may use `||`; nothing else may.
    const sharedRules = rules.filter(
      (r) =>
        /docs\.google\.com|github\.io|googleapis|bit\.ly|windows\.net/.test(
          r.condition.urlFilter ?? "",
        ) && !r.condition.urlFilter?.includes("evil.github.io"),
    );
    expect(sharedRules.length).toBeGreaterThan(0);
    for (const r of sharedRules) expect(r.condition.urlFilter?.startsWith("||")).toBe(false);
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
      { maxRules: 7 },
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

  it("falls back to an escaped regexFilter for URLs with urlFilter syntax", () => {
    const url = "https://evil.example/a*b^c|d.html?q=(1)+[2]";
    const rule = bypassRule(5, url);
    expect(rule.condition.urlFilter).toBeUndefined();
    const re = new RegExp(rule.condition.regexFilter ?? "");
    expect(re.test(new URL(url).href)).toBe(true);
    expect(re.test("https://evil.example/aXb^c|d.html?q=(1)+[2]")).toBe(false);
    expect(re.test(`${new URL(url).href}x`)).toBe(false);
  });
});

describe("trusted hosts", () => {
  it("never compiles rules for allowlisted or user-trusted hosts", () => {
    const trusted = (host: string) => host === "good.example" || host.endsWith(".good.example");
    const { rules, skipped } = compileDnrRules(
      ["good.example/", "login.good.example/x", "evil.example/"].map((expression) => ({
        expression,
        feed: "openphish" as const,
      })),
      shared,
      { trusted },
    );
    expect(skipped).toBe(2);
    expect(blocks(rules, "https://good.example/")).toBe(false);
    expect(blocks(rules, "https://login.good.example/x")).toBe(false);
    expect(blocks(rules, "https://evil.example/")).toBe(true);
  });

  it("never compiles rules for public-suffix hosts", () => {
    const { rules } = compile("co.uk/", "pages.dev/x");
    expect(rules).toEqual([]);
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
  it("writes one rule per URL with a stable id, atomically", async () => {
    const api = { updateSessionRules: vi.fn(async (_o: { removeRuleIds: number[] }) => {}) };
    await Promise.all([
      addSessionBypass(api, "https://evil.example/a#x"),
      addSessionBypass(api, "https://evil.example/a"),
    ]);
    const [first, second] = api.updateSessionRules.mock.calls.map((c) => c[0]);
    expect(first).toEqual(second);
    const id = await bypassRuleId("https://evil.example/a");
    expect(first).toEqual({
      removeRuleIds: [id],
      addRules: [expect.objectContaining({ id, action: { type: "allow" } })],
    });
  });

  it("gives different URLs different positive ids", async () => {
    const a = await bypassRuleId("https://evil.example/a");
    const b = await bypassRuleId("https://evil.example/b");
    expect(a).not.toBe(b);
    for (const id of [a, b]) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(2 ** 30);
    }
  });
});
