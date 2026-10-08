import { describe, expect, it } from "vitest";
import { type CanonicalUrl, canonicalize } from "./canonicalize.ts";
import { entryExpression } from "./expressions.ts";
import file from "./shared-hosts.json" with { type: "json" };
import {
  isEntryAllowed,
  loadSharedHosts,
  protectedLookupExpressions,
  bundledSharedHosts as shared,
} from "./shared-hosts.ts";

function c(url: string): CanonicalUrl {
  const out = canonicalize(url);
  if (!out) throw new Error(`can't canonicalize ${url}`);
  return out;
}

/** Would a feed entry for `entryUrl` match a visit to `visitUrl`? */
function matches(entryUrl: string, visitUrl: string): boolean {
  const entry = c(entryUrl);
  if (!isEntryAllowed(entry, shared)) return false;
  return protectedLookupExpressions(c(visitUrl), shared).includes(entryExpression(entry));
}

describe("shared-hosts.json", () => {
  it("loads and has unique, valid patterns", () => {
    const patterns = file.entries.map((e) => e.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(() => loadSharedHosts(file)).not.toThrow();
  });

  it("rejects malformed patterns", () => {
    const bad = { version: 1, updated: "x", entries: [{ pattern: "*.com/", group: "x" }] };
    expect(() => loadSharedHosts(bad)).toThrow();
    expect(() => loadSharedHosts({ ...file, version: 0 })).toThrow();
  });
});

describe("isShared", () => {
  it.each([
    "docs.google.com",
    "mybucket.s3.amazonaws.com",
    "mybucket.s3.us-east-1.amazonaws.com",
    "acct.blob.core.windows.net",
    "github.io",
    "www.github.io",
    "pages.dev",
    "000webhostapp.com",
    "bit.ly",
    "tenant.sharepoint.com",
  ])("%s is shared (exact-path only)", (host) => {
    expect(shared.isShared(host)).toBe(true);
    expect(shared.isListed(host)).toBe(true);
  });

  it.each(["evil.github.io", "deep.evil.github.io", "x.pages.dev", "a0512393.xsph.ru"])(
    "%s is a tenant: listed, but not path-shared",
    (host) => {
      expect(shared.isShared(host)).toBe(false);
      expect(shared.isListed(host)).toBe(true);
    },
  );

  it.each(["google.com", "mail.google.com", "example.com", "notgithub.io", "evilbit.ly"])(
    "%s is not shared",
    (host) => {
      expect(shared.isShared(host)).toBe(false);
    },
  );
});

describe("FP acceptance: shared-host matching", () => {
  const FORM_X = "https://docs.google.com/forms/d/X/viewform";

  it("a blocked Google Form blocks that exact form", () => {
    expect(matches(FORM_X, FORM_X)).toBe(true);
    expect(matches(FORM_X, `${FORM_X}?usp=sf_link`)).toBe(true);
    expect(matches(FORM_X, `${FORM_X}#frag`)).toBe(true);
  });

  it("a blocked Google Form doesn't block other forms or docs.google.com", () => {
    expect(matches(FORM_X, "https://docs.google.com/forms/d/Y/viewform")).toBe(false);
    expect(matches(FORM_X, "https://docs.google.com/")).toBe(false);
    expect(matches(FORM_X, "https://docs.google.com/forms/d/X/edit")).toBe(false);
  });

  it("an entry with a query only matches that query", () => {
    expect(matches(`${FORM_X}?a=1`, `${FORM_X}?a=1`)).toBe(true);
    expect(matches(`${FORM_X}?a=1`, `${FORM_X}?a=2`)).toBe(false);
  });

  it("path-prefix entries don't act as prefixes on shared hosts", () => {
    expect(matches("https://docs.google.com/forms/d/", FORM_X)).toBe(false);
    expect(
      matches(
        "https://storage.googleapis.com/bucket/",
        "https://storage.googleapis.com/bucket/a.html",
      ),
    ).toBe(false);
  });

  it("bare-host entries on shared hosts are rejected", () => {
    expect(isEntryAllowed(c("https://docs.google.com/"), shared)).toBe(false);
    expect(isEntryAllowed(c("https://www.000webhostapp.com/"), shared)).toBe(false);
    expect(isEntryAllowed(c("https://bit.ly/"), shared)).toBe(false);
    expect(isEntryAllowed(c("https://bit.ly/abc123"), shared)).toBe(true);
  });

  it("a bare tenant entry blocks that tenant only, never the platform", () => {
    expect(isEntryAllowed(c("https://evil.github.io/"), shared)).toBe(true);
    expect(matches("https://evil.github.io/", "https://evil.github.io/any/page")).toBe(true);
    expect(matches("https://evil.github.io/", "https://login.evil.github.io/x")).toBe(true);
    expect(matches("https://evil.github.io/", "https://good.github.io/")).toBe(false);
    expect(matches("https://evil.github.io/", "https://github.io/")).toBe(false);
    expect(matches("https://evil.github.io/", "https://www.github.io/")).toBe(false);
    expect(matches("https://x.000webhostapp.com/", "https://y.000webhostapp.com/")).toBe(false);
  });

  it("tenant lookups never reach the platform apex", () => {
    const exprs = protectedLookupExpressions(c("https://a.evil.github.io/x"), shared);
    expect(exprs.some((e) => e.startsWith("github.io/"))).toBe(false);
    expect(exprs).toContain("evil.github.io/");
  });

  it("one github.io tenant never blocks another", () => {
    expect(matches("https://evil.github.io/login.html", "https://good.github.io/login.html")).toBe(
      false,
    );
    expect(matches("https://evil.github.io/login.html", "https://evil.github.io/login.html")).toBe(
      true,
    );
    expect(matches("https://evil.github.io/login.html", "https://evil.github.io/other.html")).toBe(
      false,
    );
  });

  it("drops lookup expressions whose host is shared", () => {
    const exprs = protectedLookupExpressions(c("https://a.b.docs.google.com/x"), shared);
    expect(exprs.some((e) => e.startsWith("docs.google.com/"))).toBe(false);
    expect(exprs).toContain("a.b.docs.google.com/x");
  });
});

describe("FP acceptance: public-suffix hosts", () => {
  it("rejects entries whose host is a public suffix", () => {
    for (const url of [
      "http://co.uk/",
      "http://co.uk/login",
      "https://pages.dev/",
      "http://com/",
    ]) {
      expect(isEntryAllowed(c(url), shared), url).toBe(false);
    }
    expect(isEntryAllowed(c("http://1.2.3.4/"), shared)).toBe(true);
    expect(isEntryAllowed(c("http://evil.co.uk/"), shared)).toBe(true);
  });

  it("never looks up a public suffix as a host", () => {
    const exprs = protectedLookupExpressions(c("https://www.bbc.co.uk/news"), shared);
    expect(exprs.some((e) => e.startsWith("co.uk/"))).toBe(false);
    expect(exprs).toContain("bbc.co.uk/");
  });
});

describe("non-shared hosts keep normal SB matching", () => {
  it("a bare-host entry blocks the whole host and its subdomains", () => {
    expect(matches("http://evil.example/", "http://evil.example/any/path")).toBe(true);
    expect(matches("http://evil.example/", "http://login.evil.example/x")).toBe(true);
  });

  it("a path-prefix entry blocks paths under it only", () => {
    expect(matches("http://evil.example/kit/", "http://evil.example/kit/a.html")).toBe(true);
    expect(matches("http://evil.example/kit/", "http://evil.example/other/a.html")).toBe(false);
  });

  it("an exact-URL entry blocks that URL only", () => {
    expect(matches("http://evil.example/kit/a.html", "http://evil.example/kit/a.html")).toBe(true);
    expect(matches("http://evil.example/kit/a.html", "http://evil.example/kit/b.html")).toBe(false);
    expect(matches("http://evil.example/kit/a.html", "http://evil.example/")).toBe(false);
  });
});

describe("isTenant", () => {
  const list = loadSharedHosts({
    version: 1,
    updated: "2026-10-07",
    entries: [
      { pattern: "*.github.io", group: "hosting", kind: "tenant" },
      { pattern: "docs.google.com", group: "google" },
    ],
  });

  it("is true for a tenant subdomain on a tenant platform", () => {
    expect(list.isTenant("evil.github.io")).toBe(true);
    expect(list.isTenant("a.b.github.io")).toBe(true);
  });

  it("is false for the platform apex, www on it, path-shared hosts and other hosts", () => {
    expect(list.isTenant("github.io")).toBe(false);
    expect(list.isTenant("www.github.io")).toBe(false);
    expect(list.isTenant("docs.google.com")).toBe(false);
    expect(list.isTenant("example.com")).toBe(false);
  });
});
