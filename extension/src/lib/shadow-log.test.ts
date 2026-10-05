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
  });
});
