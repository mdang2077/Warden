import { describe, expect, it } from "vitest";
import { publicSuffix, registrableDomain, sameSite } from "./psl.ts";

describe("registrableDomain", () => {
  it.each([
    ["www.example.com", "example.com"],
    ["a.b.example.co.uk", "example.co.uk"],
    ["a.github.io", "a.github.io"],
    ["deep.a.github.io", "a.github.io"],
    ["x.web.app", "x.web.app"],
    ["y.pages.dev", "y.pages.dev"],
    ["z.workers.dev", "z.workers.dev"],
    ["foo.blogspot.com", "foo.blogspot.com"],
    ["my.vercel.app", "my.vercel.app"],
    ["site.netlify.app", "site.netlify.app"],
    ["docs.google.com", "google.com"],
  ])("%s → %s", (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });

  it.each(["github.io", "com", "co.uk", "pages.dev", "192.168.0.1", "[::1]"])(
    "%s has no registrable domain",
    (host) => {
      expect(registrableDomain(host)).toBeNull();
    },
  );
});

describe("private-section suffixes", () => {
  it("treats hosting platforms as public suffixes", () => {
    expect(publicSuffix("a.github.io")).toBe("github.io");
    expect(publicSuffix("x.web.app")).toBe("web.app");
    expect(publicSuffix("y.pages.dev")).toBe("pages.dev");
  });

  it("separates tenants on the same platform", () => {
    expect(sameSite("a.github.io", "b.github.io")).toBe(false);
    expect(sameSite("x.web.app", "y.web.app")).toBe(false);
    expect(sameSite("a.pages.dev", "b.pages.dev")).toBe(false);
  });

  it("joins hosts under one registrable domain", () => {
    expect(sameSite("mail.google.com", "docs.google.com")).toBe(true);
    expect(sameSite("www.a.github.io", "a.github.io")).toBe(true);
  });

  it("never treats unplaceable hosts as the same site", () => {
    expect(sameSite("github.io", "github.io")).toBe(false);
  });
});
