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
      aliases: ["microsoft"],
      contextAliases: ["outlook"],
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

  it("a brand in the title claims on its own (kits often name the brand only there)", () => {
    // Decided 2026-10-07: cue A ≥ 2 (66.9% phish vs 2.9% benign raw in shadow mode). A news
    // headline naming the brand claims too; warnings will need a second, independent signal.
    expect(claim({ title: "KuCoin" })).toEqual({ brand: "kucoin", cues: ["title"] });
    expect(claim({ title: "PayPal earnings beat estimates" })?.brand).toBe("paypal");
  });

  it("a brand in a button or label alone still does not claim", () => {
    expect(claim({ buttons: ["Pay with PayPal"] })).toBeNull();
    const field = {
      tag: "input" as const,
      type: "email",
      name: "email",
      id: "",
      autocomplete: "",
      placeholder: "",
      label: "PayPal email",
      inputMode: "",
      maxLength: null,
      visible: true,
      secret: null,
    };
    expect(claim({ forms: [{ action: "", method: "", loose: true, fields: [field] }] })).toBeNull();
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
    // No headings, buttons, or refHosts fields at all: no crash, title still counts.
    expect(claim({ title: "PayPal" })).toEqual({ brand: "paypal", cues: ["title"] });
    expect(claim({})).toBeNull();
  });
});

describe("cue B: references", () => {
  it("claims a brand most of the page's references point to, with some brand text", () => {
    expect(
      claim({
        buttons: ["Log in to PayPal"],
        refHosts: [
          { host: "www.paypal.com", count: 5 },
          { host: "www.paypalobjects.com", count: 2 },
          { host: "cdn.other.example", count: 3 },
        ],
      }),
    ).toEqual({ brand: "paypal", cues: ["button", "links"] });
  });

  it("links alone don't claim (social and video links on an ordinary login page)", () => {
    expect(
      claim({
        title: "Acme - Log in",
        refHosts: [
          { host: "www.google.com", count: 5 },
          { host: "cdn.acme.example", count: 1 },
        ],
      }),
    ).toBeNull();
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

describe("social-login exclusions beyond English", () => {
  it("ignores localized and hyphenated 'sign in with' mentions", () => {
    for (const input of [
      { title: "Acme", headings: ["Inicia sesión con Google"], buttons: ["Continuar con Google"] },
      { title: "Acme", headings: ["Mit Google anmelden"], buttons: ["Mit Google anmelden"] },
      { title: "Acme", headings: ["Sign-in with Google"], buttons: ["Sign-in with Google"] },
      { title: "Acme", headings: ["Google ile giriş yap"], buttons: ["Google ile giriş yap"] },
      { title: "Acme", headings: ["Masuk dengan Google"], buttons: ["Masuk dengan Google"] },
      { title: "Acme", headings: ["Entrar com Google"], buttons: ["Entrar com Google"] },
    ]) {
      expect(claim(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe("context-only aliases", () => {
  it("count a generic product name only next to a login word", () => {
    expect(claim({ title: "Outlook", headings: ["Outlook"] })).toBeNull();
    expect(
      claim({ title: "Outlook Web App - Sign in", headings: ["Outlook sign in"] })?.brand,
    ).toBe("microsoft");
  });
});

describe("cost on hostile or heavy pages", () => {
  it("ignores data-URI logos instead of scanning their contents", () => {
    const svg = `data:image/svg+xml,${encodeURIComponent(`<svg>${"paypal ".repeat(4000)}</svg>`)}`;
    expect(claim({ title: "PayPal", logoCandidates: [svg] })?.cues).toEqual(["title"]);
    expect(claim({ logoCandidates: [svg] })).toBeNull();
  });

  it("stays fast on a page with thousands of labels", () => {
    const fields = Array.from({ length: 2000 }, (_, i) => ({
      tag: "input" as const,
      type: "text",
      name: `f${i}`,
      id: "",
      autocomplete: "",
      placeholder: `Field number ${i} for your account details`,
      label: `Label ${i} with some ordinary words in it`,
      inputMode: "",
      maxLength: null,
      visible: true,
      secret: null,
    }));
    claim({ title: "x", forms: [{ action: "", method: "", loose: true, fields }] }); // warm up
    const started = performance.now();
    claim({ title: "x", forms: [{ action: "", method: "", loose: true, fields }] });
    expect(performance.now() - started).toBeLessThan(150);
  });
  // First use in a fresh process: eval/src/stage2/brand-claim-cold.test.ts (needs Node types).
});
