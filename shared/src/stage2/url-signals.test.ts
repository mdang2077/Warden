import { describe, expect, it } from "vitest";
import { loadBrands } from "../brands.ts";
import { type CanonicalUrl, canonicalize } from "../canonicalize.ts";
import { loadSharedHosts } from "../shared-hosts.ts";
import { NO_URL_SIGNALS, urlSignals } from "./url-signals.ts";

const brands = loadBrands({
  version: 1,
  brands: [
    { id: "paypal", name: "PayPal", aliases: ["paypal"], domains: ["paypal.com", "paypal.me"] },
    {
      id: "microsoft",
      name: "Microsoft",
      aliases: ["microsoft", "office 365"],
      domains: ["microsoft.com", "microsoftonline.com", "live.com"],
    },
    { id: "chase", name: "Chase", aliases: ["chase"], domains: ["chase.com"], needsContext: true },
  ],
});
const shared = loadSharedHosts({
  version: 1,
  updated: "2026-10-07",
  entries: [{ pattern: "*.github.io", group: "hosting", kind: "tenant" }],
});
const sig = (url: string) => urlSignals(canonicalize(url), brands, shared);
const fired = (url: string) =>
  Object.entries(sig(url))
    .filter(([, v]) => v)
    .map(([k]) => k);

describe("urlSignals", () => {
  it("flags lookalikes of a brand's domain label", () => {
    expect(sig("https://paypa1.com/login").lookalike).toBe(true); // digit swap
    expect(sig("https://paypai.com/login").lookalike).toBe(true); // one edit
    expect(sig("https://paypal.xyz/login").lookalike).toBe(true); // same label, other TLD
    expect(sig("https://rnicrosoft.com/").lookalike).toBe(true); // rn → m
    expect(sig("https://xn--pypal-4ve.com/").lookalike).toBe(true); // punycode
    expect(sig("https://paypa1.github.io/").lookalike).toBe(true); // tenant label
  });

  it("does not flag the brand's own hosts, unrelated names, or needsContext brands", () => {
    expect(sig("https://www.paypal.com/signin").lookalike).toBe(false);
    expect(sig("https://people.com/").lookalike).toBe(false);
    expect(sig("https://chasm.com/").lookalike).toBe(false); // chase needs context
    expect(sig("https://live.example/").lookalike).toBe(false); // live.com label < 5 chars
  });

  it("flags a brand keyword in the host or path on a site the brand doesn't own", () => {
    expect(sig("https://paypal-secure.example.com/login").brandKeyword).toBe(true);
    expect(sig("https://paypal-secure.com/").brandKeyword).toBe(true);
    expect(sig("https://example.com/paypal/login").brandKeyword).toBe(true);
    expect(sig("https://example.com/verify_microsoft-account").brandKeyword).toBe(true);
  });

  it("does not flag brand keywords on the brand's own site, multiword aliases, or needsContext brands", () => {
    expect(sig("https://www.paypal.com/paypal/login").brandKeyword).toBe(false);
    expect(sig("https://login.microsoftonline.com/common/oauth2").brandKeyword).toBe(false);
    expect(sig("https://example.com/office/365").brandKeyword).toBe(false);
    expect(sig("https://example.com/chase/login").brandKeyword).toBe(false);
    expect(sig("https://example.com/microsoft365").brandKeyword).toBe(false); // whole tokens only
  });

  it("flags IP-literal hosts, IPv4 and IPv6", () => {
    expect(sig("http://203.0.113.5/login").ipHost).toBe(true);
    const v6: CanonicalUrl = {
      url: "http://[2001:db8::1]/",
      scheme: "http",
      host: "[2001:db8::1]",
      path: "/",
      query: null,
    };
    expect(urlSignals(v6, brands, shared)).toEqual({ ...NO_URL_SIGNALS, ipHost: true });
  });

  it("flags tenants on tenant platforms but not the platform itself", () => {
    expect(sig("https://evil.github.io/").tenantPlatform).toBe(true);
    expect(sig("https://github.io/").tenantPlatform).toBe(false);
  });

  it("flags 4+ subdomain labels, not counting a leading www", () => {
    expect(sig("https://a.b.c.d.example.com/").deepSubdomain).toBe(true);
    expect(sig("https://www.a.b.c.example.com/").deepSubdomain).toBe(false);
    expect(sig("https://login.microsoftonline.com/").deepSubdomain).toBe(false);
  });

  it("treats a trailing-dot host like the host without it", () => {
    expect(fired("https://www.paypal.com./signin")).toEqual([]);
  });

  it("leaves benign SSO and sign-in hosts alone", () => {
    expect(fired("https://acme.okta.com/login")).toEqual([]);
    expect(fired("https://accounts.example.org/signin")).toEqual([]);
  });

  it("fails open on a missing URL and works without a brand list", () => {
    expect(urlSignals(null, brands, shared)).toEqual(NO_URL_SIGNALS);
    expect(urlSignals(canonicalize("https://xn--pypal-4ve.com/"), null, shared).lookalike).toBe(
      true,
    );
    expect(urlSignals(canonicalize("https://paypa1.com/"), null, shared).lookalike).toBe(false);
  });
});
