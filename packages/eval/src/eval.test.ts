import type { FeedRecord } from "@warden/service/feeds/types";
import { bundledSharedHosts as shared } from "@warden/shared/shared-hosts";
import { describe, expect, it } from "vitest";
import { parseCuratedList, splitByTime, trancoBenign } from "./corpora.ts";
import type { UrlResult } from "./evaluate.ts";
import { runEval } from "./run.ts";
import { sampleByFeed } from "./sample.ts";
import { truthTable } from "./truth.ts";

const NOW = 50 * 86_400_000;
const TRANCO = ["google.com", "paypal.com", "example.org", "github.io"];

function rec(
  url: string,
  source: FeedRecord["source"] = "openphish",
  first_seen = NOW,
): FeedRecord {
  return { url, source, first_seen, last_seen: NOW };
}

async function evalWith(
  phish: FeedRecord[],
  extraBenign: string[] = [],
  feeds: "shippable" | "all" = "all",
) {
  return runEval({
    feeds,
    benign: [
      ...trancoBenign(TRANCO, 2),
      ...extraBenign.map((url) => ({ url, label: "benign" as const, group: "extra" })),
    ],
    phish,
    trancoDomains: TRANCO,
    shared,
    now: NOW,
    meta: ["test run"],
  });
}

describe("runEval gate", () => {
  it("passes when no benign URL is blocked, and reports recall", async () => {
    const out = await evalWith([rec("https://evil.example/login"), rec("https://phish.test/x")]);
    expect(out.gatePassed).toBe(true);
    expect(out.summary).toContain("## Gate: PASS");
    expect(out.summary).toContain("| openphish | A | 2 | 2 |");
  });

  it("fails on a benign block and names the URL and feed", async () => {
    // A benign site that isn't allowlisted, listed by a Tier A feed.
    const out = await evalWith(
      [rec("https://smallbiz.example/")],
      ["https://smallbiz.example/login"],
    );
    expect(out.gatePassed).toBe(false);
    expect(out.benignBlocks.map((r) => r.url)).toEqual(["https://smallbiz.example/login"]);
    expect(out.summary).toContain("## Gate: FAIL");
    expect(out.summary).toContain("`https://smallbiz.example/login` (extra): block via openphish");
  });

  it("does not gate on Tier B alone (escalate), but reports it", async () => {
    const out = await evalWith(
      [rec("https://smallbiz.example/", "phishing_database")],
      ["https://smallbiz.example/login"],
    );
    expect(out.gatePassed).toBe(true);
    expect(out.tierB).toContain("| phishing_database | 1 | 1 | 0 | 0.00% | 1 |");
  });

  it("drops feed entries on allowlisted domains and counts them as Tier B collisions", async () => {
    const out = await evalWith([rec("https://www.paypal.com/signin", "phishstats")]);
    expect(out.tierB).toMatch(/\| phishstats \| 1 \| 0 \| 1 \| 100\.00% \|/);
    expect(out.tierB).toContain("https://www.paypal.com/signin");
  });

  it("shows how much the client allowlist is doing", async () => {
    // Listed under an allowlisted domain: dropped at cleaning, so no block either way.
    const out = await evalWith([rec("https://example.org/")]);
    expect(out.gatePassed).toBe(true);
  });
});

describe("runEval feeds mode (T4b.4)", () => {
  it("shippable: feeds that can't reach users never block, and the report says so", async () => {
    const out = await evalWith(
      [rec("https://smallbiz.example/"), rec("https://evil.example/login")],
      ["https://smallbiz.example/login"],
      "shippable",
    );
    expect(out.gatePassed).toBe(true); // OpenPhish is eval-only: its entry can't block
    expect(out.benignBlocks).toEqual([]);
    expect(out.summary).toContain("Feeds: shippable");
    expect(out.summary).toMatch(/\| openphish \| A \| 2 \| 0 \|/); // blocked in prod: 0
  });

  it("all: every configured feed blocks, for research", async () => {
    const out = await evalWith([rec("https://evil.example/login")], [], "all");
    expect(out.summary).toContain("Feeds: all");
    expect(out.summary).toContain("| openphish | A | 1 | 1 |");
  });
});

describe("splitByTime", () => {
  it("holds out the newest records", () => {
    const records = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) =>
      rec(`https://p${t}.example/`, "openphish", t),
    );
    const split = splitByTime(records, 0.2);
    expect(split?.test.map((r) => r.first_seen)).toEqual([9, 10]);
    expect(split?.train).toHaveLength(8);
  });

  it("refuses to split a single snapshot", () => {
    expect(splitByTime([rec("https://a.example/"), rec("https://b.example/")])).toBeNull();
  });
});

describe("corpora helpers", () => {
  it("parses curated lists with groups and comments", () => {
    expect(
      parseCuratedList(
        "# c\n[banks]\nhttps://bank.example/\n\n[sso]\nhttps://sso.example/x\nnot a url\n",
      ),
    ).toEqual([
      { url: "https://bank.example/", label: "benign", group: "banks" },
      { url: "https://sso.example/x", label: "benign", group: "sso" },
    ]);
  });

  it("samples deterministically per feed", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      rec(`https://p${i}.example/`, i % 2 ? "openphish" : "phishstats"),
    );
    const a = sampleByFeed(records, 3, 7);
    expect(a).toHaveLength(6);
    expect(sampleByFeed(records, 3, 7)).toEqual(a);
    expect(sampleByFeed(records, 100, 7)).toEqual(records);
  });
});

describe("truthTable", () => {
  it("counts the block-only and flagged views", () => {
    const r = (label: "benign" | "phish", decision: UrlResult["decision"]): UrlResult => ({
      url: "u",
      label,
      group: "g",
      decision,
      feeds: [],
      allowlisted: false,
    });
    const results = [
      r("phish", "block"),
      r("phish", "escalate"),
      r("benign", "escalate"),
      r("benign", "allow"),
    ];
    expect(truthTable(results, "block")).toEqual({ tp: 1, fp: 0, tn: 2, fn: 1 });
    expect(truthTable(results, "flagged")).toEqual({ tp: 2, fp: 1, tn: 1, fn: 0 });
  });
});
