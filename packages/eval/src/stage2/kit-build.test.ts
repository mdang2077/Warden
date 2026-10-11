import { describe, expect, it } from "vitest";
import { buildKits, type PageFingerprint } from "./kit-build.ts";

const fp = (hash: string, site: string, split: "tune" | "holdout" = "tune"): PageFingerprint => ({
  hash,
  site,
  split,
  gated: true,
});

describe("buildKits", () => {
  it("keeps skeletons seen on enough distinct tune phish sites", () => {
    const phish = [
      fp("aaaaaaaaaaaaaaaa", "a.example"),
      fp("aaaaaaaaaaaaaaaa", "b.example"),
      fp("bbbbbbbbbbbbbbbb", "a.example"),
      fp("bbbbbbbbbbbbbbbb", "a.example"),
    ];
    expect(buildKits(phish, [], 2)).toEqual(["aaaaaaaaaaaaaaaa"]);
  });

  it("ignores holdout phish, so the holdout split measures unseen kits", () => {
    const phish = [
      fp("aaaaaaaaaaaaaaaa", "a.example"),
      fp("aaaaaaaaaaaaaaaa", "b.example", "holdout"),
    ];
    expect(buildKits(phish, [], 2)).toEqual([]);
  });

  it("drops a skeleton that any tune benign page has", () => {
    const phish = [fp("aaaaaaaaaaaaaaaa", "a.example"), fp("aaaaaaaaaaaaaaaa", "b.example")];
    expect(buildKits(phish, [fp("aaaaaaaaaaaaaaaa", "real.example")], 2)).toEqual([]);
    expect(buildKits(phish, [fp("aaaaaaaaaaaaaaaa", "real.example", "holdout")], 2)).toEqual([
      "aaaaaaaaaaaaaaaa",
    ]);
  });
});
