import { describe, expect, it } from "vitest";
import { isSpike, type QualityLog, recordQuality } from "./quality.ts";
import { getJson, memoryStore } from "./storage.ts";

function log(run_at: number, ingested: number, dropped: number): QualityLog {
  return {
    run_at,
    published: true,
    version: run_at,
    allowlist: { refreshed: false },
    feeds: {
      openphish: {
        polled: true,
        not_modified: false,
        ingested,
        dropped_allowlist: dropped,
        allowlist_drop_ratio: ingested ? dropped / ingested : 0,
        allowlist_samples: ["https://www.paypal.com/x"],
      },
    },
    alerts: [],
  };
}

describe("isSpike", () => {
  it("never alerts below the floor", () => {
    expect(isSpike(0.04, [0, 0, 0])).toBe(false);
  });

  it("alerts on a jump well above the usual ratio", () => {
    expect(isSpike(0.3, [0.01, 0.02, 0.01, 0.02])).toBe(true);
    expect(isSpike(0.06, [0.02, 0.03, 0.02])).toBe(false);
  });

  it("uses an absolute threshold with little history", () => {
    expect(isSpike(0.1, [])).toBe(false);
    expect(isSpike(0.25, [0.01])).toBe(true);
  });
});

describe("recordQuality", () => {
  it("writes the log and alerts on a spike", async () => {
    const store = memoryStore();
    for (let t = 1; t <= 4; t++) await recordQuality(store, log(t, 100, 1));
    const out = await recordQuality(store, log(5, 100, 40));
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]).toContain("openphish");
    expect(out.alerts[0]).toContain("40/100");
    expect(await getJson(store, "logs/quality/5.json")).toEqual(out);
  });

  it("stays quiet for a steady feed", async () => {
    const store = memoryStore();
    for (let t = 1; t <= 6; t++) {
      expect((await recordQuality(store, log(t, 100, 2))).alerts).toEqual([]);
    }
  });
});
