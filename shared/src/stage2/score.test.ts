import { describe, expect, it } from "vitest";
import { type ScoreInput, score, WARN_THRESHOLD } from "./score.ts";
import { NO_URL_SIGNALS } from "./url-signals.ts";

const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  brandMismatch: null,
  exfil: null,
  url: NO_URL_SIGNALS,
  gated: true,
  eligible: true,
  ...over,
});
const url = (over: Partial<typeof NO_URL_SIGNALS>) => ({ ...NO_URL_SIGNALS, ...over });

describe("score", () => {
  it("matches the spec's worked examples", () => {
    const telegram = { kind: "telegram" as const, ip: false };
    const cases: [ScoreInput, number, string][] = [
      [input({ brandMismatch: { cues: 1 }, exfil: telegram }), 10, "warn_candidate"],
      [input({ brandMismatch: { cues: 2 }, url: url({ lookalike: true }) }), 10, "warn_candidate"],
      [
        input({ brandMismatch: { cues: 2 }, url: url({ tenantPlatform: true }) }),
        8,
        "warn_candidate",
      ],
      [input({ brandMismatch: { cues: 1 }, url: url({ tenantPlatform: true }) }), 6, "suspicious"],
      [input({ url: url({ lookalike: true, ipHost: true, deepSubdomain: true }) }), 4, "none"],
    ];
    for (const [i, points, decision] of cases) {
      expect(score(i)).toMatchObject({ points, decision, rawDecision: decision });
    }
  });

  it("counts only the strongest signal per family and lists the rest uncounted", () => {
    const r = score(
      input({ url: url({ lookalike: true, brandKeyword: true, deepSubdomain: true }) }),
    );
    expect(r.points).toBe(4);
    expect(r.contributions).toEqual([
      { family: "urlHost", signal: "lookalike", points: 4, anchor: false, counted: true },
      { family: "urlHost", signal: "brandKeyword", points: 3, anchor: false, counted: false },
      { family: "urlHost", signal: "deepSubdomain", points: 1, anchor: false, counted: false },
    ]);
  });

  it("needs two families: a strong anchor plus the IP lookup in the same family stays suspicious", () => {
    const r = score(input({ exfil: { kind: "telegram", ip: true } }));
    expect(r.points).toBe(6);
    expect(r.decision).toBe("suspicious");
  });

  it("needs an anchor: supporting signals alone never warn", () => {
    const r = score(input({ exfil: { kind: null, ip: true }, url: url({ lookalike: true }) }), 1);
    expect(r.decision).toBe("none");
  });

  it("never warns on identifier-only steps", () => {
    const r = score(
      input({ brandMismatch: { cues: 2 }, exfil: { kind: "discord", ip: false }, gated: false }),
    );
    expect(r.points).toBe(12);
    expect(r.decision).toBe("suspicious");
    expect(r.rawDecision).toBe("suspicious");
  });

  it("keeps the raw decision when the page isn't eligible", () => {
    const r = score(
      input({
        brandMismatch: { cues: 2 },
        exfil: { kind: "telegram", ip: false },
        eligible: false,
      }),
    );
    expect(r.decision).toBe("suspicious");
    expect(r.rawDecision).toBe("warn_candidate");
  });

  it("weighs a cross-site form below an exfil endpoint", () => {
    const r = score(
      input({ exfil: { kind: "crossSiteForm", ip: false }, url: url({ tenantPlatform: true }) }),
    );
    expect(r.points).toBe(6);
    expect(r.decision).toBe("suspicious");
  });

  it("takes a threshold for sweeps", () => {
    const i = input({ brandMismatch: { cues: 1 }, url: url({ tenantPlatform: true }) });
    expect(score(i, 6).decision).toBe("warn_candidate");
    expect(score(i, WARN_THRESHOLD).decision).toBe("suspicious");
  });

  it("returns none with no signals", () => {
    expect(score(input())).toEqual({
      points: 0,
      decision: "none",
      rawDecision: "none",
      contributions: [],
    });
  });
});
