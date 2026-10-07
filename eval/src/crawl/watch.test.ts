import type { FeedRecord } from "@warden/service/feeds/types";
import { describe, expect, it } from "vitest";
import { type PriorCrawl, selectTargets } from "./watch.ts";

const T0 = 1_000_000;
const MIN = 60_000;

function rec(
  url: string,
  first_seen: number,
  source: FeedRecord["source"] = "openphish",
): FeedRecord {
  return { url, source, first_seen, last_seen: first_seen };
}

const base = {
  now: T0 + 120 * MIN,
  initializedAt: T0,
  backlogPerFeed: 1,
  firstCycle: false,
  maxPerCycle: 100,
};

describe("selectTargets", () => {
  it("crawls new URLs newest first and skips ones already crawled", () => {
    const prior = new Map<string, PriorCrawl>([
      ["https://done.example/", { ok: true, attempt: 1, crawled_at: T0 }],
    ]);
    const out = selectTargets(
      [
        rec("https://a.example/", T0 + MIN),
        rec("https://b.example/", T0 + 5 * MIN),
        rec("https://done.example/", T0 + 2 * MIN),
      ],
      (u) => prior.get(u) ?? null,
      base,
    );
    expect(out.map((t) => t.target.url)).toEqual(["https://b.example/", "https://a.example/"]);
    expect(out[0]).toMatchObject({ attempt: 1, target: { label: "phish", group: "openphish" } });
  });

  it("retries a failure once, after 30 minutes", () => {
    const failed = (crawled_at: number, attempt: number): PriorCrawl => ({
      ok: false,
      attempt,
      crawled_at,
    });
    const urls = [
      rec("https://late.example/", T0 + MIN),
      rec("https://soon.example/", T0 + MIN),
      rec("https://dead.example/", T0 + MIN),
    ];
    const prior = new Map<string, PriorCrawl>([
      ["https://late.example/", failed(base.now - 31 * MIN, 1)],
      ["https://soon.example/", failed(base.now - 10 * MIN, 1)],
      ["https://dead.example/", failed(base.now - 60 * MIN, 2)],
    ]);
    const out = selectTargets(urls, (u) => prior.get(u) ?? null, base);
    expect(out).toEqual([
      { target: { url: "https://late.example/", label: "phish", group: "openphish" }, attempt: 2 },
    ]);
  });

  it("samples the backlog per feed only on the first cycle", () => {
    const backlog = [
      rec("https://o1.example/", T0 - MIN),
      rec("https://o2.example/", T0 - 2 * MIN),
      rec("https://p1.example/", T0 - MIN, "phishing_database"),
    ];
    const first = selectTargets(backlog, () => null, { ...base, firstCycle: true });
    expect(first.map((t) => t.target.url).sort()).toEqual([
      "https://o1.example/",
      "https://p1.example/",
    ]);
    expect(selectTargets(backlog, () => null, base)).toEqual([]);
  });

  it("treats URLs first seen at initialization as backlog", () => {
    // The watcher's first ingest stamps every URL first_seen = initializedAt.
    const firstPull = Array.from({ length: 5 }, (_, i) => rec(`https://f${i}.example/`, T0));
    const fresh = rec("https://fresh.example/", T0 + MIN);
    expect(selectTargets([...firstPull, fresh], () => null, base)).toEqual([
      { target: { url: "https://fresh.example/", label: "phish", group: "openphish" }, attempt: 1 },
    ]);
  });

  it("caps the number of crawls per cycle", () => {
    const many = Array.from({ length: 10 }, (_, i) => rec(`https://n${i}.example/`, T0 + i));
    expect(selectTargets(many, () => null, { ...base, maxPerCycle: 3 })).toHaveLength(3);
  });
});
