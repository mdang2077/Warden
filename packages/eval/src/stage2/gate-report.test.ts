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
      intercepted: 0,
      tlsReset: 0,
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
    expect(md).toContain("| banks | 1 | 0 | 0 | 1 | 1 | 100.0% | 0.0% | 1 / 0 / 0 / 0 |");
    expect(md).toContain("| **all** | 2 | 0 | 0 | 2 | 1 | 50.0% |");
    expect(md).toContain("| openphish | 1 | 0 | 0 | 1 | 1 | 100.0% |");
  });
});

describe("interceptions", () => {
  it("excludes ISP block pages and TLS resets from the gate rate", () => {
    const blocked = {
      group: "openphish",
      ok: true,
      gated: false,
      final_url: "https://block.charter-prod.hosted.cujo.io/warn.html",
      snapshot: {
        title: "",
        text: "Suspicious Site Blocked",
        secrets: { password: 0, otp: 0, card: 0, seed: 0 },
        identifierFields: 0,
      },
    } as unknown as CrawlRecord;
    const reset = {
      group: "openphish",
      ok: false,
      error: "net::ERR_SSL_PROTOCOL_ERROR",
      snapshot: null,
    } as unknown as CrawlRecord;
    const stats = groupStats([blocked, reset, rec("openphish", { password: 1 })]).get("openphish");
    expect(stats).toMatchObject({ crawled: 3, intercepted: 1, tlsReset: 1, ok: 1, gated: 1 });
  });
});
