import { describe, expect, it } from "vitest";
import { type BrandsFile, bundledBrands, bundledBrandsFile, loadBrands } from "./brands.ts";
import { registrableDomain } from "./psl.ts";

const file = (brands: BrandsFile["brands"]): BrandsFile => ({ version: 1, brands });
const paypal = { id: "paypal", name: "PayPal", aliases: ["paypal"], domains: ["paypal.com"] };

describe("brand list", () => {
  it("loads the shipped file", () => {
    expect(bundledBrands).not.toBeNull();
    expect(bundledBrands?.brands.length).toBeGreaterThanOrEqual(80);
  });

  it("lists only registrable domains in the shipped file", () => {
    for (const b of bundledBrandsFile.brands) {
      for (const d of b.domains) expect(registrableDomain(d), `${b.id}: ${d}`).toBe(d);
    }
  });

  it("finds a brand by id and by any host under its domains", () => {
    const list = loadBrands(file([paypal]));
    expect(list.byId("paypal")?.name).toBe("PayPal");
    expect(list.ownerOf("www.paypal.com")?.id).toBe("paypal");
    expect(list.ownerOf("paypal.com")?.id).toBe("paypal");
    expect(list.ownerOf("paypal.com.evil.example")).toBeUndefined();
    expect(list.ownerOf("notpaypal.com")).toBeUndefined();
  });

  it("rejects duplicate ids, bad aliases, empty domains, and shared domains", () => {
    const bad: BrandsFile["brands"][] = [
      [paypal, { ...paypal }],
      [{ ...paypal, aliases: ["PayPal"] }],
      [{ ...paypal, contextAliases: ["Outlook"] }],
      [{ ...paypal, contextAliases: [""] }],
      [{ ...paypal, aliases: [" paypal"] }],
      [{ ...paypal, aliases: [] }],
      [{ ...paypal, domains: [] }],
      [{ ...paypal, id: "Pay Pal" }],
      [paypal, { id: "other", name: "Other", aliases: ["other"], domains: ["paypal.com"] }],
    ];
    for (const brands of bad) expect(() => loadBrands(file(brands))).toThrow(/brands:/);
    expect(() => loadBrands({ version: 0, brands: [paypal] })).toThrow(/version/);
  });
});
