import { describe, expect, it } from "vitest";
import { addFpReport, listFpReports, MAX_FP_REPORTS } from "./fp-reports.ts";
import { clearTabVerdict, getTabVerdict, setTabVerdict } from "./tab-state.ts";
import { memoryArea } from "./test-utils.ts";

describe("tab verdicts", () => {
  it("stores, reads, and clears per tab", async () => {
    const area = memoryArea();
    const verdict = {
      url: "https://phish.example/",
      decision: "block" as const,
      sources: ["openphish" as const],
      bypassed: false,
      at: 1,
    };
    await setTabVerdict(area, 7, verdict);
    expect(await getTabVerdict(area, 7)).toEqual(verdict);
    expect(await getTabVerdict(area, 8)).toBeNull();
    await clearTabVerdict(area, 7);
    expect(await getTabVerdict(area, 7)).toBeNull();
  });
});

describe("FP reports", () => {
  it("appends and caps the log", async () => {
    const area = memoryArea();
    for (let i = 0; i < MAX_FP_REPORTS + 3; i++) {
      await addFpReport(area, {
        url: `https://x.example/${i}`,
        decision: "block",
        sources: [],
        at: i,
      });
    }
    const reports = await listFpReports(area);
    expect(reports).toHaveLength(MAX_FP_REPORTS);
    expect(reports[0]?.at).toBe(3);
  });
});
