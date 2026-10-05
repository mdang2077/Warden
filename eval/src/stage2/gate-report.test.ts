import { describe, expect, it } from "vitest";
import type { CrawlRecord } from "../crawl/crawler.ts";
import { groupStats, renderGateReport } from "./gate-report.ts";

function rec(
  group: string,
  opts: { ok?: boolean; password?: number; identifier?: number } = {},
): CrawlRecord {
  const ok = opts.ok ?? true;
  const password = opts.password ?? 0;
  return {
    group,
    ok,
    gated: password > 0,
    snapshot: ok
      ? ({
          secrets: { password, otp: 0, card: 0, seed: 0 },
          identifierFields: opts.identifier ?? 0,
        } as CrawlRecord["snapshot"])
      : null,
  } as CrawlRecord;
}

describe("gate report", () => {
  it("counts gated, identifier-only, and dead pages per group", () => {
    const stats = groupStats([
      rec("banks", { password: 1 }),
      rec("banks", { identifier: 1 }),
      rec("banks"),
      rec("banks", { ok: false }),
    ]);
    expect(stats.get("banks")).toEqual({
      crawled: 4,
      ok: 3,
      gated: 1,
      identifierOnly: 1,
      kinds: { password: 1, otp: 0, card: 0, seed: 0 },
    });
  });

  it("renders both sections with totals", () => {
    const md = renderGateReport(
      [rec("banks", { password: 1 }), rec("tranco-home")],
      [rec("openphish", { password: 2 })],
      ["test"],
    );
    expect(md).toContain("| banks | 1 | 1 | 1 | 100.0% | 0.0% | 1 / 0 / 0 / 0 |");
    expect(md).toContain("| **all** | 2 | 2 | 1 | 50.0% |");
    expect(md).toContain("| openphish | 1 | 1 | 1 | 100.0% |");
  });
});
