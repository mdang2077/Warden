import { loadBrands } from "@warden/shared/brands";
import { describe, expect, it } from "vitest";
import {
  appendShadowEntry,
  createShadowRecorder,
  listShadowEntries,
  MAX_SHADOW_ENTRIES,
  parseFieldsMessage,
  type ShadowEntry,
} from "./shadow-log.ts";
import { memoryArea } from "./test-utils.ts";

const PW = { password: 1, otp: 0, card: 0, seed: 0 };
const NONE = { password: 0, otp: 0, card: 0, seed: 0 };
const msg = (secrets = PW, identifierFields = 0) => ({
  type: "warden:fields",
  secrets,
  identifierFields,
});
const sender = (url = "https://login.example.com/signin?token=SECRET#x", frameId = 0) => ({
  tabId: 4,
  frameId,
  url,
});

function setup(t = { now: 0 }) {
  const area = memoryArea();
  const record = createShadowRecorder({
    area,
    allowlisted: (host) => host.endsWith("bank.example"),
    stage1For: async () => "allow",
    now: () => t.now,
  });
  return { area, record, t };
}

describe("parseFieldsMessage", () => {
  it("accepts counts and rejects anything malformed", () => {
    expect(parseFieldsMessage(msg())).toEqual(msg());
    for (const bad of [
      null,
      { type: "other" },
      { ...msg(), secrets: { ...PW, password: -1 } },
      { ...msg(), secrets: { password: 1 } },
      { ...msg(), identifierFields: "3" },
    ]) {
      expect(parseFieldsMessage(bad)).toBeNull();
    }
  });
});

describe("shadow recorder", () => {
  it("logs gated pages without the query, fragment, or any page content", async () => {
    const { area, record } = setup();
    const entry = await record(msg(), sender());
    expect(entry).toEqual({
      at: 0,
      page: "https://login.example.com/signin",
      domain: "example.com",
      kind: "gate",
      secrets: PW,
      identifierFields: 0,
      allowlisted: false,
      stage1: "allow",
      score: { points: 0, decision: "none", signals: [] },
    });
    expect(JSON.stringify(await listShadowEntries(area))).not.toContain("SECRET");
  });

  it("logs identifier-only steps separately from the gate", async () => {
    const { record } = setup();
    expect((await record(msg(NONE, 1), sender()))?.kind).toBe("identifier");
    expect((await record(msg(PW), sender()))?.kind).toBe("gate");
  });

  it("marks allowlisted domains", async () => {
    const { record } = setup();
    expect((await record(msg(), sender("https://www.bank.example/login")))?.allowlisted).toBe(true);
  });

  it("ignores subframes, non-evaluated URLs, pages with nothing, and bad messages", async () => {
    const { area, record } = setup();
    await record(msg(), sender("https://login.example.com/", 3));
    await record(msg(), sender("http://192.168.1.1/login"));
    await record(msg(NONE, 0), sender());
    await record({ type: "warden:fields" }, sender());
    expect(await listShadowEntries(area)).toEqual([]);
  });

  it("logs a page once per ten minutes per tab", async () => {
    const { area, record, t } = setup();
    await record(msg(), sender());
    await record(msg(), sender("https://login.example.com/signin?other=1"));
    t.now = 11 * 60_000;
    await record(msg(), sender());
    expect(await listShadowEntries(area)).toHaveLength(2);
  });

  it("caps the log", async () => {
    const area = memoryArea();
    const e = { at: 0 } as ShadowEntry;
    for (let i = 0; i < MAX_SHADOW_ENTRIES + 5; i++) await appendShadowEntry(area, { ...e, at: i });
    const log = await listShadowEntries(area);
    expect(log).toHaveLength(MAX_SHADOW_ENTRIES);
    expect(log[0]?.at).toBe(5);
    // 2,000+ sequential appends, each copying the growing log: slow on a busy machine.
  }, 30_000);
});

const testBrands = loadBrands({
  version: 1,
  brands: [
    { id: "chase", name: "Chase", aliases: ["chase"], domains: ["chase.com"], needsContext: true },
  ],
});
const CLAIM = { brand: "chase", cues: ["title", "heading"] };

describe("brand mismatch in the shadow log", () => {
  it("accepts messages without a claim and drops a malformed claim", () => {
    expect(parseFieldsMessage(msg())).toEqual(msg());
    expect(parseFieldsMessage({ ...msg(), brandClaim: CLAIM })).toEqual({
      ...msg(),
      brandClaim: CLAIM,
    });
    for (const bad of [
      { brand: "Chase!", cues: ["title"] },
      { brand: "chase", cues: ["title", "telepathy"] },
      { brand: "chase", cues: "title" },
      "chase",
    ]) {
      expect(parseFieldsMessage({ ...msg(), brandClaim: bad })).toEqual(msg());
    }
  });

  it("records a mismatch when the page isn't on the brand's domains", async () => {
    const area = memoryArea();
    const record = createShadowRecorder({
      area,
      allowlisted: () => false,
      stage1For: async () => "allow",
      brands: testBrands,
      now: () => 0,
    });
    const entry = await record(
      { ...msg(), brandClaim: CLAIM },
      sender("https://chase-verify.example/login"),
    );
    expect(entry?.brandMismatch).toEqual(CLAIM);
    const own = await record(
      { ...msg(), brandClaim: CLAIM },
      sender("https://secure.chase.com/login"),
    );
    expect(own).not.toHaveProperty("brandMismatch");
  });

  it("records no mismatch when brands are unavailable", async () => {
    const record = createShadowRecorder({
      area: memoryArea(),
      allowlisted: () => false,
      stage1For: async () => "allow",
      brands: null,
      now: () => 0,
    });
    const entry = await record(
      { ...msg(), brandClaim: CLAIM },
      sender("https://chase-verify.example/"),
    );
    expect(entry).not.toHaveProperty("brandMismatch");
  });
});

describe("credential exfiltration in the shadow log", () => {
  const SCAN = { endpoint: "telegram", ip: true, formHosts: ["collect.other.example"] };

  it("parses the scan and drops a malformed one", () => {
    expect(parseFieldsMessage({ ...msg(), exfil: SCAN })).toEqual({ ...msg(), exfil: SCAN });
    for (const bad of [
      { ...SCAN, endpoint: "carrier-pigeon" },
      { ...SCAN, ip: "yes" },
      { ...SCAN, formHosts: "collect.other.example" },
      { ...SCAN, formHosts: ["not a host!"] },
      { ...SCAN, formHosts: Array.from({ length: 11 }, (_, i) => `h${i}.example`) },
    ]) {
      expect(parseFieldsMessage({ ...msg(), exfil: bad })).toEqual(msg());
    }
  });

  it("records the kind of exfiltration, never the hosts", async () => {
    const { record } = setup();
    const entry = await record(
      { ...msg(), exfil: { endpoint: null, ip: false, formHosts: ["collect.other.example"] } },
      sender("https://secure-login.evil.example/"),
    );
    expect(entry?.exfil).toEqual({ kind: "crossSiteForm", ip: false });
    expect(JSON.stringify(entry)).not.toContain("collect.other.example");
  });

  it("records nothing for a same-site form with no endpoint", async () => {
    const { record } = setup();
    const entry = await record(
      { ...msg(), exfil: { endpoint: null, ip: false, formHosts: ["auth.example.com"] } },
      sender("https://login.example.com/"),
    );
    expect(entry).not.toHaveProperty("exfil");
  });
});

describe("trusted sites in the shadow log", () => {
  it("marks entries for sites the user trusts, and only those", async () => {
    const record = createShadowRecorder({
      area: memoryArea(),
      allowlisted: () => false,
      stage1For: async () => "allow",
      trusted: async (host) => host.endsWith("shop.example"),
      now: () => 0,
    });
    expect((await record(msg(), sender("https://www.shop.example/login")))?.trusted).toBe(true);
    expect(await record(msg(), sender("https://other.example/login"))).not.toHaveProperty(
      "trusted",
    );
  });
});

describe("Stage 2 score in the shadow log", () => {
  const brands = loadBrands({
    version: 1,
    brands: [{ id: "paypal", name: "PayPal", aliases: ["paypal"], domains: ["paypal.com"] }],
  });
  const phishy = {
    ...msg(PW),
    brandClaim: { brand: "paypal", cues: ["title", "logo"] },
    exfil: { endpoint: "telegram", ip: false, formHosts: [] },
  };
  const recorder = () =>
    createShadowRecorder({
      area: memoryArea(),
      allowlisted: (host) => host.endsWith("bank.example"),
      stage1For: async () => null,
      brands,
    });

  it("stores points, decision and counted signal names only", async () => {
    const entry = await recorder()(phishy, sender("https://paypal-secure.example.com/login?x=1"));
    expect(entry?.score).toEqual({
      points: 16,
      decision: "warn_candidate",
      signals: ["brandMismatch:2cues", "exfil:telegram", "brandKeyword"],
    });
    expect(JSON.stringify(entry?.score)).not.toContain("example");
  });

  it("never makes an allowlisted page a warn candidate", async () => {
    const entry = await recorder()(phishy, sender("https://paypal.bank.example/login"));
    expect(entry?.score?.decision).toBe("suspicious");
  });

  it("scores identifier steps without ever warning", async () => {
    const entry = await recorder()(
      { ...phishy, ...msg({ password: 0, otp: 0, card: 0, seed: 0 }, 1) },
      sender("https://paypal-secure.example.com/login"),
    );
    expect(entry?.kind).toBe("identifier");
    expect(entry?.score?.decision).toBe("suspicious");
  });
});
