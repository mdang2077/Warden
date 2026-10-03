import "fake-indexeddb/auto";
import { type CanonicalUrl, canonicalize } from "@warden/shared/canonicalize";
import { entryExpression, sha256, toHex } from "@warden/shared/expressions";
import { bundledSharedHosts as shared } from "@warden/shared/shared-hosts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ListStore, openListStore } from "./list-store.ts";

const NOW = 1_000_000;
const LATER = NOW + 86_400_000;

function c(url: string): CanonicalUrl {
  const out = canonicalize(url);
  if (!out) throw new Error(url);
  return out;
}

async function entry(url: string, expiresAt = LATER) {
  return { hash: toHex(await sha256(entryExpression(c(url)))), expiresAt };
}

let store: ListStore;
let dbCount = 0;

beforeEach(async () => {
  store = await openListStore(`test-${dbCount++}`);
  await store.setFeedConfig("openphish", { tier: "A", enabled: true });
  await store.setFeedConfig("phishing_database", { tier: "B", enabled: true });
});

afterEach(() => store.close());

describe("list store", () => {
  it("matches an exact URL entry with feed, tier, and expression", async () => {
    await store.replaceFeed("openphish", [await entry("http://evil.example/kit/a.html")]);
    expect(await store.match(c("http://evil.example/kit/a.html?x=1"), shared, NOW)).toEqual([
      { feed: "openphish", tier: "A", expression: "evil.example/kit/a.html" },
    ]);
    expect(await store.match(c("http://evil.example/kit/b.html"), shared, NOW)).toEqual([]);
  });

  it("matches a bare-host entry across the host", async () => {
    await store.replaceFeed("openphish", [await entry("http://evil.example/")]);
    const hits = await store.match(c("http://login.evil.example/x/y"), shared, NOW);
    expect(hits.map((h) => h.expression)).toEqual(["evil.example/"]);
  });

  it("reports hits from several feeds", async () => {
    const e = await entry("http://evil.example/a");
    await store.replaceFeed("openphish", [e]);
    await store.replaceFeed("phishing_database", [e]);
    const hits = await store.match(c("http://evil.example/a"), shared, NOW);
    expect(hits.map((h) => `${h.feed}:${h.tier}`).sort()).toEqual([
      "openphish:A",
      "phishing_database:B",
    ]);
  });

  it("ignores expired entries and prunes them", async () => {
    await store.replaceFeed("openphish", [
      await entry("http://old.example/", NOW - 1),
      await entry("http://new.example/"),
    ]);
    expect(await store.match(c("http://old.example/"), shared, NOW)).toEqual([]);
    expect(await store.pruneExpired(NOW)).toBe(1);
    expect(await store.count("openphish")).toBe(1);
  });

  it("ignores disabled and unconfigured feeds (kill switch)", async () => {
    const e = await entry("http://evil.example/");
    await store.replaceFeed("openphish", [e]);
    await store.replaceFeed("phishstats", [e]);
    await store.setFeedConfig("openphish", { tier: "A", enabled: false });
    expect(await store.match(c("http://evil.example/"), shared, NOW)).toEqual([]);
  });

  it("uses the current tier from config, not the tier at write time", async () => {
    await store.replaceFeed("phishing_database", [await entry("http://evil.example/")]);
    await store.setFeedConfig("phishing_database", { tier: "A", enabled: true });
    const [hit] = await store.match(c("http://evil.example/"), shared, NOW);
    expect(hit?.tier).toBe("A");
  });

  it("replaceFeed drops the old snapshot; applyDelta adds and removes", async () => {
    const a = await entry("http://a.example/");
    const b = await entry("http://b.example/");
    await store.replaceFeed("openphish", [a]);
    await store.replaceFeed("openphish", [b]);
    expect(await store.match(c("http://a.example/"), shared, NOW)).toEqual([]);

    await store.applyDelta("openphish", [a], [b.hash]);
    expect(await store.match(c("http://a.example/"), shared, NOW)).toHaveLength(1);
    expect(await store.match(c("http://b.example/"), shared, NOW)).toEqual([]);
  });

  it("replacing one feed leaves the others alone", async () => {
    const e = await entry("http://evil.example/");
    await store.replaceFeed("openphish", [e]);
    await store.replaceFeed("phishing_database", []);
    expect(await store.count("openphish")).toBe(1);
  });

  it("applies shared-host protection", async () => {
    // Even if a bad entry slipped past ingest, a host-level entry on a shared host never matches.
    await store.replaceFeed("openphish", [
      await entry("https://docs.google.com/"),
      await entry("https://docs.google.com/forms/d/X/viewform"),
    ]);
    expect(await store.match(c("https://docs.google.com/forms/d/Y/viewform"), shared, NOW)).toEqual(
      [],
    );
    expect(
      await store.match(c("https://docs.google.com/forms/d/X/viewform?usp=sf"), shared, NOW),
    ).toHaveLength(1);
  });
});
