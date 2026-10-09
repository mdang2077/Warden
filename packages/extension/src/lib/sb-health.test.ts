import type { SafeBrowsing, SafeBrowsingVerdict } from "@warden/shared/stage1";
import { describe, expect, it, vi } from "vitest";
import { readSbHealth, sbDegraded, withHealthTracking } from "./sb-health.ts";
import { memoryArea } from "./test-utils.ts";

const URL_ = {
  url: "https://a.example/",
  scheme: "https",
  host: "a.example",
  path: "/",
  query: null,
};

function client(results: SafeBrowsingVerdict[]): SafeBrowsing {
  return { check: vi.fn(async () => results.shift() ?? { hit: false, expressions: [] }) };
}

describe("sbDegraded", () => {
  it("is true while the latest lookup failed recently", () => {
    expect(sbDegraded({ lastOkAt: 100, lastErrorAt: 200 }, 300)).toBe(true);
    expect(sbDegraded({ lastOkAt: null, lastErrorAt: 200 }, 300)).toBe(true);
  });

  it("is false once a lookup succeeds again, or when the failure is old, or with no data", () => {
    expect(sbDegraded({ lastOkAt: 250, lastErrorAt: 200 }, 300)).toBe(false);
    expect(sbDegraded({ lastOkAt: null, lastErrorAt: 0 }, 16 * 60_000)).toBe(false);
    expect(sbDegraded({ lastOkAt: null, lastErrorAt: null }, 0)).toBe(false);
  });
});

describe("withHealthTracking", () => {
  it("records failures and recoveries without changing the verdicts", async () => {
    const area = memoryArea();
    let t = 1_000;
    const inner = client([
      { hit: false, expressions: [], error: "proxy returned 503" },
      { hit: true, expressions: ["a.example/"] },
    ]);
    const tracked = withHealthTracking(inner, area, () => t);
    expect(await tracked.check(URL_)).toMatchObject({ error: "proxy returned 503" });
    expect(await readSbHealth(area)).toEqual({ lastOkAt: null, lastErrorAt: 1_000 });
    t = 2_000;
    expect(await tracked.check(URL_)).toMatchObject({ hit: true });
    expect(await readSbHealth(area)).toEqual({ lastOkAt: 2_000, lastErrorAt: 1_000 });
  });

  it("doesn't write storage on every successful lookup", async () => {
    const area = memoryArea();
    const set = vi.spyOn(area, "set");
    const tracked = withHealthTracking(client([]), area, () => 5);
    await tracked.check(URL_);
    await tracked.check(URL_);
    await tracked.check(URL_);
    expect(set).toHaveBeenCalledTimes(1); // the first success, then no change
  });
});
