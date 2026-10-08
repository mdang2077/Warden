import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize.ts";
import {
  entryExpression,
  expressionsForUrl,
  hashExpressions,
  hostSuffixes,
  pathPrefixes,
  sha256,
  toHex,
} from "./expressions.ts";

const sorted = (xs: string[]) => [...xs].sort();

/** Examples from the Safe Browsing API docs, "Suffix/Prefix Expressions". */
describe("lookup expressions: Google examples", () => {
  it("http://a.b.c/1/2.html?param=1", () => {
    expect(sorted(expressionsForUrl("http://a.b.c/1/2.html?param=1"))).toEqual(
      sorted([
        "a.b.c/1/2.html?param=1",
        "a.b.c/1/2.html",
        "a.b.c/",
        "a.b.c/1/",
        "b.c/1/2.html?param=1",
        "b.c/1/2.html",
        "b.c/",
        "b.c/1/",
      ]),
    );
  });

  it("http://a.b.c.d.e.f.g/1.html", () => {
    expect(sorted(expressionsForUrl("http://a.b.c.d.e.f.g/1.html"))).toEqual(
      sorted([
        "a.b.c.d.e.f.g/1.html",
        "a.b.c.d.e.f.g/",
        "c.d.e.f.g/1.html",
        "c.d.e.f.g/",
        "d.e.f.g/1.html",
        "d.e.f.g/",
        "e.f.g/1.html",
        "e.f.g/",
        "f.g/1.html",
        "f.g/",
      ]),
    );
  });

  it("http://1.2.3.4/1/", () => {
    expect(sorted(expressionsForUrl("http://1.2.3.4/1/"))).toEqual(
      sorted(["1.2.3.4/1/", "1.2.3.4/"]),
    );
  });

  it("http://a.b/saw-cgi/eBayISAPI.dll/", () => {
    expect(sorted(expressionsForUrl("http://a.b/saw-cgi/eBayISAPI.dll/"))).toEqual(
      sorted(["a.b/saw-cgi/eBayISAPI.dll/", "a.b/saw-cgi/", "a.b/"]),
    );
  });
});

describe("limits", () => {
  it("never yields more than 5 hosts or 6 paths", () => {
    expect(hostSuffixes("a.b.c.d.e.f.g.h.i")).toHaveLength(5);
    expect(pathPrefixes("/1/2/3/4/5/6/7.html", "q=1")).toHaveLength(6);
    expect(
      expressionsForUrl("http://a.b.c.d.e.f.g.h/1/2/3/4/5/x.html?q").length,
    ).toBeLessThanOrEqual(30);
  });

  it("never yields a bare TLD", () => {
    expect(hostSuffixes("example.com")).toEqual(["example.com"]);
  });

  it("returns nothing for an unusable URL", () => {
    expect(expressionsForUrl("http://")).toEqual([]);
  });
});

describe("feed entry expression", () => {
  it("is the exact host + path + query", () => {
    const url = canonicalize("https://Phish.Example/Login/?a=1#x");
    expect(url && entryExpression(url)).toBe("phish.example/Login/?a=1");
  });

  it("is one of the lookup expressions for the same URL", () => {
    const raw = "http://evil.example/a/b.html?x=1";
    const url = canonicalize(raw);
    expect(url && expressionsForUrl(raw)).toContain(url && entryExpression(url));
  });
});

describe("hashing", () => {
  it("matches the documented SHA-256 of abc", async () => {
    expect(toHex(await sha256("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("takes a 4-byte prefix", async () => {
    const [h] = await hashExpressions(["abc"]);
    expect(h?.prefix).toBe("ba7816bf");
    expect(h?.hash.startsWith(h.prefix)).toBe(true);
  });
});
