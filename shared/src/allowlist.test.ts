import { describe, expect, it } from "vitest";
import {
  buildAllowlist,
  createAllowlistStage,
  hasAllowlistHit,
  parseAllowlist,
  serializeAllowlist,
} from "./allowlist.ts";
import { bundledSharedHosts as shared } from "./shared-hosts.ts";
import type { NavigationContext } from "./types.ts";

const TRANCO = [
  "google.com",
  "www.facebook.com",
  "docs.google.com",
  "dropbox.com",
  "github.io",
  "000webhostapp.com",
  "bbc.co.uk",
  "google.com",
  "example.org",
];

function ctx(url: string): NavigationContext {
  return { url, tabId: 1, redirectChain: [], startedAt: 0 };
}

describe("buildAllowlist", () => {
  it("keeps registrable domains, dedupes, and drops shared hosts", () => {
    expect(buildAllowlist(TRANCO, shared)).toEqual([
      "bbc.co.uk",
      "example.org",
      "facebook.com",
      "google.com",
    ]);
  });

  it("only takes the top N", () => {
    expect(buildAllowlist(TRANCO, shared, 2)).toEqual(["facebook.com", "google.com"]);
  });

  it("round-trips through text", () => {
    const text = serializeAllowlist(buildAllowlist(TRANCO, shared));
    expect(parseAllowlist(text, shared).size).toBe(4);
  });
});

describe("Allowlist.allows", () => {
  const list = parseAllowlist("google.com\nbbc.co.uk\n", shared);

  it("allows any host under an allowlisted registrable domain", () => {
    expect(list.allows("google.com")).toBe(true);
    expect(list.allows("mail.google.com")).toBe(true);
    expect(list.allows("www.bbc.co.uk")).toBe(true);
  });

  it("never allows shared hosts, even under an allowlisted domain", () => {
    expect(list.allows("docs.google.com")).toBe(false);
    expect(list.allows("sites.google.com")).toBe(false);
  });

  it("doesn't allow look-alikes or unlisted domains", () => {
    expect(list.allows("google.com.evil.example")).toBe(false);
    expect(list.allows("evil-google.com")).toBe(false);
  });
});

describe("allowlist stage", () => {
  const stage = createAllowlistStage({
    allowlist: () => parseAllowlist("google.com\n", shared),
    userDomains: () => new Set(["mybank.example", "github.io"]),
    shared: () => shared,
  });

  it("signals an allowlist hit without ending the cascade", async () => {
    const r = await stage.evaluate(ctx("https://mail.google.com/x"), []);
    expect(r.decision).toBe("allow");
    expect(r.final).toBeUndefined();
    expect(r.signals).toEqual([{ id: "allowlist_hit", source: "allowlist" }]);
    expect(hasAllowlistHit([r])).toBe(true);
  });

  it("signals user-marked domains", async () => {
    const r = await stage.evaluate(ctx("https://login.mybank.example/"), []);
    expect(r.signals).toEqual([{ id: "allowlist_hit", source: "user_override" }]);
  });

  it("ignores user overrides on shared hosts", async () => {
    const r = await stage.evaluate(ctx("https://evil.github.io/"), []);
    expect(r.signals).toEqual([]);
  });

  it("reports nothing for a miss, a shared host, or an unusable URL", async () => {
    for (const url of ["https://evil.example/", "https://docs.google.com/forms/d/X", "http://"]) {
      const r = await stage.evaluate(ctx(url), []);
      expect(r.signals).toEqual([]);
      expect(hasAllowlistHit([r])).toBe(false);
    }
  });

  it("reports nothing before the first sync", async () => {
    const empty = createAllowlistStage({
      allowlist: () => null,
      userDomains: () => new Set(),
      shared: () => shared,
    });
    expect((await empty.evaluate(ctx("https://google.com/"), [])).signals).toEqual([]);
  });
});
