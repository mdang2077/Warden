import { describe, expect, it } from "vitest";
import { loadBrands } from "../brands.ts";
import { type BrandInput, detectBrandClaim, normalizeText } from "./brand-claim.ts";

const brands = loadBrands({
  version: 1,
  brands: [
    {
      id: "paypal",
      name: "PayPal",
      aliases: ["paypal"],
      domains: ["paypal.com", "paypalobjects.com"],
    },
    {
      id: "google",
      name: "Google",
      aliases: ["google", "gmail"],
      domains: ["google.com", "gstatic.com"],
    },
    {
      id: "microsoft",
      name: "Microsoft",
      aliases: ["microsoft", "outlook"],
      domains: ["microsoft.com"],
    },
    { id: "chase", name: "Chase", aliases: ["chase"], domains: ["chase.com"], needsContext: true },
    { id: "kucoin", name: "KuCoin", aliases: ["kucoin"], domains: ["kucoin.com"] },
  ],
});
const claim = (input: BrandInput) => detectBrandClaim(input, brands);

describe("normalizeText", () => {
  it("folds look-alike letters, case, and spacing", () => {
    expect(normalizeText("Ku𝐂oin  Login")).toBe("kucoin login");
    expect(normalizeText("Pаypal")).toBe("paypal"); // Cyrillic а
    expect(normalizeText("MICROSOFT\n\tAccount")).toBe("microsoft account");
  });
});

describe("cue A: identity text", () => {
  it("claims a brand named in the title and a heading", () => {
    expect(claim({ title: "Log in to your PayPal account", headings: ["PayPal"] })).toEqual({
      brand: "paypal",
      cues: ["title", "heading"],
    });
  });

  it("counts a logo filename or alt text", () => {
    expect(
      claim({ title: "PayPal", logoCandidates: ["https://x.example/img/paypal-logo.svg"] })?.cues,
    ).toEqual(["title", "logo"]);
  });

  it("a brand in the title alone does not claim without a second location", () => {
    expect(claim({ title: "PayPal earnings beat estimates" })).toBeNull();
  });

  it("ignores social-login and share mentions", () => {
    expect(
      claim({
        title: "Acme Login",
        headings: ["Sign in with Google", "Follow us on Google"],
        buttons: ["Continue with Google"],
      }),
    ).toBeNull();
  });

  it("needs a login word next to short or common-word brands", () => {
    expect(claim({ title: "Chase", headings: ["Chase the dream"] })).toBeNull();
    expect(claim({ title: "Chase Online - Sign In", headings: ["Chase sign in"] })?.brand).toBe(
      "chase",
    );
  });

  it("matches look-alike spellings", () => {
    expect(claim({ title: "Ku𝐂oin Login", headings: ["KuCoin"] })?.brand).toBe("kucoin");
  });

  it("tolerates a schema-1 snapshot", () => {
    expect(claim({ title: "PayPal" })).toBeNull();
    expect(claim({})).toBeNull();
  });
});

describe("cue B: references", () => {
  it("claims a brand most of the page's references point to", () => {
    expect(
      claim({
        refHosts: [
          { host: "www.paypal.com", count: 5 },
          { host: "www.paypalobjects.com", count: 2 },
          { host: "cdn.other.example", count: 3 },
        ],
      }),
    ).toEqual({ brand: "paypal", cues: ["links"] });
  });

  it("does not claim when another site gets more references", () => {
    expect(
      claim({
        refHosts: [
          { host: "www.paypal.com", count: 4 },
          { host: "a.cdn.other.example", count: 3 },
          { host: "b.other.example", count: 3 },
        ],
      }),
    ).toBeNull();
  });

  it("claims on moderate text plus a couple of references", () => {
    expect(
      claim({ title: "PayPal", refHosts: [{ host: "www.paypal.com", count: 2 }] })?.cues,
    ).toEqual(["title", "links"]);
  });
});

describe("ties", () => {
  it("makes no claim when two brands are equally strong", () => {
    expect(
      claim({
        title: "Sign in: Google or Microsoft",
        headings: ["Google and Microsoft accounts"],
      }),
    ).toBeNull();
  });
});
