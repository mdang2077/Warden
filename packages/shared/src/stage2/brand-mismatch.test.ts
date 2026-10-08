import { describe, expect, it } from "vitest";
import { bundledBrands, loadBrands } from "../brands.ts";
import { brandMismatch } from "./brand-mismatch.ts";

const brands = loadBrands({
  version: 1,
  brands: [
    {
      id: "microsoft",
      name: "Microsoft",
      aliases: ["microsoft"],
      domains: ["microsoft.com", "microsoftonline.com", "live.com"],
    },
    { id: "amazon", name: "Amazon", aliases: ["amazon"], domains: ["amazon.com", "amazon.co.jp"] },
    { id: "chase", name: "Chase", aliases: ["chase"], domains: ["chase.com"], needsContext: true },
  ],
});
const claim = (brand: string) => ({ brand, cues: ["title" as const, "heading" as const] });

describe("brandMismatch", () => {
  it("never fires on the brand's own domains, including sign-in and regional ones", () => {
    expect(brandMismatch(claim("microsoft"), "login.microsoftonline.com", brands)).toBe(false);
    expect(brandMismatch(claim("microsoft"), "outlook.live.com", brands)).toBe(false);
    expect(brandMismatch(claim("amazon"), "www.amazon.co.jp", brands)).toBe(false);
  });

  it("fires on lookalike hosts, hosting-platform tenants, and IPs", () => {
    expect(brandMismatch(claim("microsoft"), "microsoft.com.login-verify.example", brands)).toBe(
      true,
    );
    expect(brandMismatch(claim("chase"), "justinjayjay.github.io", brands)).toBe(true);
    expect(brandMismatch(claim("chase"), "203.0.113.5", brands)).toBe(true);
  });

  it("does nothing for an unknown brand id", () => {
    expect(brandMismatch(claim("nobody"), "evil.example", brands)).toBe(false);
  });
});

describe("shipped brand list: brands' own regional and sign-in sites", () => {
  it("never mismatches on them", () => {
    const shipped = bundledBrands;
    if (!shipped) throw new Error("bundled brands invalid");
    for (const [brand, host] of [
      ["microsoft", "www.microsoft365.com"],
      ["santander", "www.santanderbank.com"],
      ["santander", "www.bancosantander.es"],
      ["santander", "www.santander.com.mx"],
      ["hsbc", "www.hsbc.com.hk"],
      ["hsbc", "www.hsbcnet.com"],
      ["barclays", "www.barclaysus.com"],
      ["yahoo", "login.yahoo.co.jp"],
      ["orange", "www.orange.es"],
      ["orange", "www.orange.pl"],
      ["amazon", "www.amazon.com.tr"],
      ["okta", "login.okta-emea.com"],
      ["laposte", "www.laposte.net"],
    ] as const) {
      expect(brandMismatch(claim(brand), host, shipped), `${brand} on ${host}`).toBe(false);
    }
  });
});
