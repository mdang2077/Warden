import { describe, expect, it } from "vitest";
import type { FeatureRow, FeaturesHeader } from "./features.ts";
import { gateFailures, renderScoreReport } from "./score-report.ts";

const NO_URL = {
  lookalike: false,
  brandKeyword: false,
  ipHost: false,
  tenantPlatform: false,
  deepSubdomain: false,
};
const row = (over: Partial<FeatureRow>): FeatureRow => ({
  label: "benign",
  group: "tranco-login",
  split: "tune",
  gated: true,
  allowlisted: true,
  brandMismatch: null,
  exfil: null,
  url: NO_URL,
  ...over,
});
const WARN = { brandMismatch: { cues: 2 }, exfil: { kind: "telegram" as const, ip: false } };
const header: FeaturesHeader = {
  header: true,
  schema: 1,
  sourceHash: "h",
  generated: "2026-10-07T00:00:00.000Z",
  counts: { benign: 0, phish: 0, skipped: 0 },
};
const benign = (n: number) => Array.from({ length: n }, () => row({}));

describe("gateFailures", () => {
  it("passes at or under budget and fails over it, using the raw rate", () => {
    const ok = [...benign(999), row(WARN)]; // 1 / 1000 = 0.1%, allowlisted but raw counts
    expect(gateFailures(ok, header, "h")).toEqual([]);
    const over = [...benign(998), row(WARN), row(WARN)];
    expect(gateFailures(over, header, "h")[0]).toMatch(/2 of 1000/);
  });

  it("ignores identifier steps and phish rows in the benign rate", () => {
    const rows = [...benign(10), row({ ...WARN, gated: false }), row({ ...WARN, label: "phish" })];
    expect(gateFailures(rows, header, "h")).toEqual([]);
  });

  it("fails on a stale source hash", () => {
    expect(gateFailures(benign(10), header, "other")[0]).toMatch(/rerun `harness.ts extract`/);
  });

  it("fails with no benign gated pages instead of reporting 0%", () => {
    expect(gateFailures([row({ label: "phish" })], header, "h")[0]).toMatch(
      /no benign gated pages/,
    );
  });
});

describe("renderScoreReport", () => {
  it("writes the truth table, sweep, signal rates and benign warn candidates without hosts", () => {
    const rows = [
      ...benign(3),
      row({ ...WARN, group: "banks", split: "holdout" }),
      row({ ...WARN, label: "phish", group: "openphish", allowlisted: false }),
      row({
        label: "phish",
        group: "openphish",
        allowlisted: false,
        url: { ...NO_URL, tenantPlatform: true },
      }),
    ];
    const md = renderScoreReport(rows, header);
    expect(md).toContain("# Stage 2 score report (S2.11)");
    // label | group | split | login pages | gated | suspicious | warn (raw) | warn (eligible)
    expect(md).toContain("| benign | banks | holdout | 1 | 1 | 0 | 1 | 0 |");
    expect(md).toContain("| phish | openphish | tune | 2 | 2 | 0 | 1 | 1 |");
    expect(md).toMatch(/\| 8 \| 1 of 4 \(25\.00%\) \| 1 of 2 \(50\.00%\) \|/);
    expect(md).toContain("| tenantPlatform | 0 | 1 |");
    expect(md).toContain("brandMismatch:2cues + exfil:telegram");
    expect(md).toContain("## Benign warn candidates (raw): 1");
  });
});
