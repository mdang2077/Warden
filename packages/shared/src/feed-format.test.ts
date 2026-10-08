import { describe, expect, it } from "vitest";
import { deltaChain, FEED_DISTRIBUTION, type Manifest } from "./feed-format.ts";

function manifest(version: number, deltas: [number, number][]): Manifest {
  const ref = { key: "k", sha256: "s" };
  return {
    schema: 1,
    version,
    created: 0,
    snapshot: ref,
    deltas: deltas.map(([from, to]) => ({ ...ref, from, to })),
    allowlist: { ...ref, count: 0 },
    sharedHosts: { ...ref, version: 1 },
    feeds: {
      openphish: { enabled: true, tier: "A" },
      phishing_database: { enabled: false, tier: "B" },
      phishstats: { enabled: false, tier: "B" },
    },
  };
}

describe("deltaChain", () => {
  const m = manifest(40, [
    [10, 20],
    [20, 30],
    [30, 40],
  ]);

  it("returns the deltas from the client's version to the latest", () => {
    expect(deltaChain(m, 20)?.map((d) => d.to)).toEqual([30, 40]);
    expect(deltaChain(m, 10)?.map((d) => d.to)).toEqual([20, 30, 40]);
  });

  it("returns an empty chain when already current", () => {
    expect(deltaChain(m, 40)).toEqual([]);
  });

  it("returns null when the client is too old, unknown, or the chain has a gap", () => {
    expect(deltaChain(m, 5)).toBeNull();
    expect(deltaChain(m, 25)).toBeNull();
    expect(
      deltaChain(
        manifest(40, [
          [10, 20],
          [25, 40],
        ]),
        10,
      ),
    ).toBeNull();
    expect(deltaChain(manifest(50, [[10, 20]]), 10)).toBeNull();
  });
});

describe("FEED_DISTRIBUTION", () => {
  it("keeps feeds whose terms forbid redistribution out of what users download", () => {
    expect(FEED_DISTRIBUTION).toEqual({
      openphish: "eval_only",
      phishstats: "eval_only",
      phishing_database: "shippable",
    });
  });
});
