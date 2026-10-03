import { describe, expect, it } from "vitest";
import { canonicalize, canonicalizeBytes, parseIPv4 } from "./canonicalize.ts";

/**
 * Test vectors from the Safe Browsing API docs, "URLs and Hashing" → "Canonicalization".
 * They're byte strings, so they go through canonicalizeBytes.
 */
const GOOGLE_VECTORS: [string, string][] = [
  ["http://host/%25%32%35", "http://host/%25"],
  ["http://host/%25%32%35%25%32%35", "http://host/%25%25"],
  ["http://host/%2525252525252525", "http://host/%25"],
  ["http://host/asdf%25%32%35asd", "http://host/asdf%25asd"],
  ["http://host/%%%25%32%35asd%%", "http://host/%25%25%25asd%25%25"],
  ["http://www.google.com/", "http://www.google.com/"],
  [
    "http://%31%36%38%2e%31%38%38%2e%39%39%2e%32%36/%2E%73%65%63%75%72%65/%77%77%77%2E%65%62%61%79%2E%63%6F%6D/",
    "http://168.188.99.26/.secure/www.ebay.com/",
  ],
  [
    "http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/",
    "http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/",
  ],
  [
    "http://host%23.com/%257Ea%2521b%2540c%2523d%2524e%25f%255E00%252611%252A22%252833%252944_55%252B",
    "http://host%23.com/~a!b@c%23d$e%25f^00&11*22(33)44_55+",
  ],
  ["http://3279880203/blah", "http://195.127.0.11/blah"],
  ["http://www.google.com/blah/..", "http://www.google.com/"],
  ["www.google.com/", "http://www.google.com/"],
  ["www.google.com", "http://www.google.com/"],
  ["http://www.evil.com/blah#frag", "http://www.evil.com/blah"],
  ["http://www.GOOgle.com/", "http://www.google.com/"],
  ["http://www.google.com.../", "http://www.google.com/"],
  ["http://www.google.com/foo\tbar\rbaz\n2", "http://www.google.com/foobarbaz2"],
  ["http://www.google.com/q?", "http://www.google.com/q?"],
  ["http://www.google.com/q?r?", "http://www.google.com/q?r?"],
  ["http://www.google.com/q?r?s", "http://www.google.com/q?r?s"],
  ["http://evil.com/foo#bar#baz", "http://evil.com/foo"],
  ["http://evil.com/foo;", "http://evil.com/foo;"],
  ["http://evil.com/foo?bar;", "http://evil.com/foo?bar;"],
  ["http://\x01\x80.com/", "http://%01%80.com/"],
  ["http://notrailingslash.com", "http://notrailingslash.com/"],
  ["http://www.gotaport.com:1234/", "http://www.gotaport.com/"],
  ["  http://www.google.com/  ", "http://www.google.com/"],
  ["http:// leadingspace.com/", "http://%20leadingspace.com/"],
  ["http://%20leadingspace.com/", "http://%20leadingspace.com/"],
  ["%20leadingspace.com/", "http://%20leadingspace.com/"],
  ["https://www.securesite.com/", "https://www.securesite.com/"],
  ["http://host.com/ab%23cd", "http://host.com/ab%23cd"],
  ["http://host.com//twoslashes?more//slashes", "http://host.com/twoslashes?more//slashes"],
];

describe("canonicalize: Google test vectors", () => {
  it.each(GOOGLE_VECTORS)("%j", (input, expected) => {
    expect(canonicalizeBytes(input)?.url).toBe(expected);
  });
});

describe("canonicalize: components", () => {
  it("splits host, path, and query", () => {
    expect(canonicalize("HTTPS://User:pw@Sub.Example.COM:8443/a/./b/../c?x=1#frag")).toEqual({
      url: "https://sub.example.com/a/c?x=1",
      scheme: "https",
      host: "sub.example.com",
      path: "/a/c",
      query: "x=1",
    });
  });

  it("keeps a trailing slash and an empty query", () => {
    expect(canonicalize("http://a.example/b/c/?")).toMatchObject({ path: "/b/c/", query: "" });
  });

  it("treats an escaped ? in the path as part of the path, not a query", () => {
    expect(canonicalize("http://a.example/x%3Fy%23z")?.url).toBe("http://a.example/x?y%23z");
    expect(canonicalize("http://a.example/x%3Fy")?.query).toBeNull();
  });

  it("UTF-8 encodes non-ASCII input", () => {
    expect(canonicalize("http://a.example/café")?.url).toBe("http://a.example/caf%C3%A9");
  });

  it("leaves IPv6 hosts alone apart from case and port", () => {
    expect(canonicalize("http://[2001:DB8::1]:8080/x")?.url).toBe("http://[2001:db8::1]/x");
  });

  it.each(["", "http://", "http:///path", "http://.../"])("returns null for %j", (input) => {
    expect(canonicalize(input)).toBeNull();
  });
});

describe("parseIPv4", () => {
  it.each([
    ["1.2.3.4", "1.2.3.4"],
    ["0x7f.1", "127.0.0.1"],
    ["017700000001", "127.0.0.1"],
    ["0300.0250.0.1", "192.168.0.1"],
    ["0xC0.0xA8.0x00.0x01", "192.168.0.1"],
    ["3279880203", "195.127.0.11"],
    ["10.0x10000", "10.1.0.0"],
    ["0", "0.0.0.0"],
  ])("%s → %s", (input, expected) => {
    expect(parseIPv4(input)).toBe(expected);
  });

  it.each(["example.com", "1.2.3.4.5", "256.1.1.1", "4294967296", "08.1.1.1", "1..2", ""])(
    "rejects %s",
    (input) => {
      expect(parseIPv4(input)).toBeNull();
    },
  );
});
