import { describe, expect, it } from "vitest";
import type { ShadowEntry } from "./shadow-log.ts";
import { describeSignals, shadowExport, shadowSummary } from "./shadow-summary.ts";

const NONE = { password: 0, otp: 0, card: 0, seed: 0 };
function entry(over: Partial<ShadowEntry>): ShadowEntry {
  return {
    at: 1000,
    page: "https://login.example.com/signin",
    domain: "example.com",
    kind: "gate",
    secrets: { ...NONE, password: 1 },
    identifierFields: 0,
    allowlisted: false,
    stage1: "allow",
    ...over,
  };
}

describe("shadowSummary", () => {
  it("counts pages by kind and decision, and lists would-have-warned pages newest first", () => {
    const s = shadowSummary([
      entry({ at: 1, kind: "identifier", score: { points: 0, decision: "none", signals: [] } }),
      entry({
        at: 2,
        score: { points: 4, decision: "suspicious", signals: ["brandMismatch:1cue"] },
      }),
      entry({
        at: 3,
        domain: "evil.example",
        page: "https://evil.example/login",
        score: {
          points: 10,
          decision: "warn_candidate",
          signals: ["brandMismatch:1cue", "exfil:telegram"],
        },
      }),
      entry({
        at: 4,
        domain: "bad.example",
        page: "https://bad.example/",
        score: {
          points: 8,
          decision: "warn_candidate",
          signals: ["exfil:discord", "tenantPlatform"],
        },
      }),
    ]);
    expect(s).toEqual({
      total: 4,
      gate: 3,
      identifier: 1,
      suspicious: 1,
      since: 1,
      warns: [
        {
          at: 4,
          domain: "bad.example",
          page: "https://bad.example/",
          signals: ["exfil:discord", "tenantPlatform"],
        },
        {
          at: 3,
          domain: "evil.example",
          page: "https://evil.example/login",
          signals: ["brandMismatch:1cue", "exfil:telegram"],
        },
      ],
    });
  });

  it("counts entries logged before scoring existed without guessing a decision", () => {
    const s = shadowSummary([entry({ at: 5 }), entry({ at: 6, kind: "identifier" })]);
    expect(s).toMatchObject({
      total: 2,
      gate: 1,
      identifier: 1,
      suspicious: 0,
      warns: [],
      since: 5,
    });
  });

  it("handles an empty log", () => {
    expect(shadowSummary([])).toEqual({
      total: 0,
      gate: 0,
      identifier: 0,
      suspicious: 0,
      since: null,
      warns: [],
    });
  });

  it("falls back to the page's host when an entry has no registrable domain", () => {
    const s = shadowSummary([
      entry({
        domain: null,
        page: "http://203.0.113.5/login",
        score: { points: 9, decision: "warn_candidate", signals: ["exfil:telegram", "ipHost"] },
      }),
    ]);
    expect(s.warns[0]?.domain).toBe("203.0.113.5");
  });
});

describe("describeSignals", () => {
  it("turns signal names into plain words and keeps unknown names as they are", () => {
    expect(describeSignals(["brandMismatch:2cues", "exfil:telegram", "tenantPlatform"])).toBe(
      "claims a brand (2+ cues) + sends to Telegram + free-hosting subdomain",
    );
    expect(describeSignals(["somethingNew"])).toBe("somethingNew");
    expect(describeSignals([])).toBe("");
  });
});

describe("shadowExport", () => {
  it("names the file by date and writes the entries as indented JSON", () => {
    const entries = [entry({})];
    const out = shadowExport(entries, Date.UTC(2026, 9, 8, 12));
    expect(out.filename).toBe("warden-shadow-log-2026-10-08.json");
    expect(JSON.parse(out.json)).toEqual({ exported: "2026-10-08T12:00:00.000Z", entries });
  });
});
