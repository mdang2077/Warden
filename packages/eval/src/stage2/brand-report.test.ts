import { loadBrands } from "@warden/shared/brands";
import { describe, expect, it } from "vitest";
import { type BrandRow, judge, renderBrandReport } from "./brand-report.ts";

const brands = loadBrands({
  version: 1,
  brands: [{ id: "paypal", name: "PayPal", aliases: ["paypal"], domains: ["paypal.com"] }],
});

function row(over: Partial<BrandRow>): BrandRow {
  return {
    group: "g",
    label: "phish",
    host: "paypal-verify.example",
    title: "PayPal - Log in",
    kind: "gate",
    input: { title: "PayPal - Log in", headings: ["PayPal"] },
    allowlisted: false,
    ...over,
  };
}

describe("brand report", () => {
  it("judges claims and mismatches", () => {
    expect(judge(row({}), brands)).toEqual({
      claim: { brand: "paypal", cues: ["title", "heading"] },
      mismatch: true,
    });
    expect(judge(row({ host: "www.paypal.com" }), brands).mismatch).toBe(false);
    expect(judge(row({ input: { title: "Acme login" } }), brands)).toEqual({
      claim: null,
      mismatch: false,
    });
  });

  it("lists every benign firing and every phish miss, with allowlisted counts", () => {
    const md = renderBrandReport(
      [
        row({
          group: "banks",
          label: "benign",
          host: "reseller.example",
          title: "PayPal reseller",
        }),
        row({ group: "banks", label: "benign", host: "big.example", allowlisted: true }),
      ],
      [
        row({ group: "openphish" }),
        row({ group: "openphish", input: { title: "Webmail" }, title: "Webmail" }),
      ],
      brands,
      ["test"],
    );
    expect(md).toContain("## Benign firings (2)");
    expect(md).toContain("reseller.example");
    expect(md).toContain("## Phish misses (1)");
    expect(md).toContain("Webmail");
    expect(md).toMatch(/\| banks \| 2 \| 2 \| 2 \| 1 \|/); // pages, claims, mismatches raw, excluding allowlisted
    expect(md).toContain("## Threshold sweep");
    // The sweep also counts benign firings that survive the allowlist (warnings need that).
    expect(md).toContain("| 3 | 0.3 | 1 (50.0%) | 2 (100.0%) | 1 |");
  });
});
