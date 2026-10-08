import { parseAllowlist } from "@warden/shared/allowlist";
import { bundledSharedHosts as shared } from "@warden/shared/shared-hosts";
import { describe, expect, it } from "vitest";
import { ENTRY_TTL_MS } from "./feeds/ingest.ts";
import type { FeedRecord } from "./feeds/types.ts";
import { cleanFeed } from "./pipeline.ts";

const NOW = 100 * 24 * 60 * 60_000;
const allowlist = parseAllowlist("google.com\npaypal.com\n", shared);

function rec(url: string, last_seen = NOW, first_seen = last_seen): FeedRecord {
  return { url, source: "openphish", first_seen, last_seen };
}

async function clean(records: FeedRecord[]) {
  return cleanFeed(records, { allowlist, shared, now: NOW });
}

describe("cleanFeed", () => {
  it("canonicalizes into hashed expressions with an expiry", async () => {
    const { entries } = await clean([rec("HTTP://Evil.Example/Login/../a#x")]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      expression: "evil.example/a",
      expiresAt: NOW + ENTRY_TTL_MS,
    });
    expect(entries[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("drops entries on allowlisted domains and samples them", async () => {
    const { entries, stats } = await clean([
      rec("https://www.paypal.com/signin"),
      rec("https://accounts.google.com/x"),
      rec("https://paypal.com.evil.example/"),
    ]);
    expect(entries.map((e) => e.expression)).toEqual(["paypal.com.evil.example/"]);
    expect(stats.dropped_allowlist).toBe(2);
    expect(stats.allowlist_samples).toEqual([
      "https://www.paypal.com/signin",
      "https://accounts.google.com/x",
    ]);
  });

  it("keeps path-specific entries on shared hosts under allowlisted domains", async () => {
    const { entries } = await clean([rec("https://docs.google.com/forms/d/X/viewform")]);
    expect(entries.map((e) => e.expression)).toEqual(["docs.google.com/forms/d/X/viewform"]);
  });

  it("drops bare-host entries on path-shared hosts and platform apexes", async () => {
    const { entries, stats } = await clean([
      rec("https://github.io/"),
      rec("https://storage.googleapis.com"),
    ]);
    expect(entries).toEqual([]);
    expect(stats.dropped_shared_host).toBe(2);
  });

  it("keeps bare-host entries on tenant subdomains, even of Tranco-ranked platforms", async () => {
    const { entries, stats } = await cleanFeed([rec("https://evil.000webhostapp.com/")], {
      allowlist: parseAllowlist("000webhostapp.com\n", shared),
      shared,
      now: NOW,
    });
    expect(entries.map((e) => e.expression)).toEqual(["evil.000webhostapp.com/"]);
    expect(stats.dropped_allowlist).toBe(0);
  });

  it("drops invalid and non-http entries", async () => {
    const { stats } = await clean([rec("http://"), rec("ftp://files.example/x")]);
    expect(stats.invalid).toBe(2);
  });

  it("drops entries not seen within the TTL", async () => {
    const { entries, stats } = await clean([
      rec("https://old.example/", NOW - ENTRY_TTL_MS - 1),
      rec("https://new.example/", NOW - ENTRY_TTL_MS),
    ]);
    expect(entries.map((e) => e.expression)).toEqual(["new.example/"]);
    expect(stats.dropped_ttl).toBe(1);
  });

  it("dedupes by canonical expression, merging seen times", async () => {
    const { entries, stats } = await clean([
      rec("https://evil.example/a", NOW - 5, NOW - 50),
      rec("https://EVIL.example/a#frag", NOW, NOW - 10),
    ]);
    expect(stats.duplicates).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ first_seen: NOW - 50, last_seen: NOW });
  });

  it("counts every record exactly once", async () => {
    const { stats } = await clean([
      rec("https://www.paypal.com/x"),
      rec("https://evil.github.io/"),
      rec("http://"),
      rec("https://old.example/", 0),
      rec("https://a.example/"),
      rec("https://a.example/"),
    ]);
    const { ingested, allowlist_samples: _, ...rest } = stats;
    expect(Object.values(rest).reduce((a, b) => a + b, 0)).toBe(ingested);
  });
});
