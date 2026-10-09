import { describe, expect, it } from "vitest";
import { memoryStore } from "./storage.ts";
import { loadSuppressed, normalizeSuppressed, SUPPRESS_KEY, saveSuppressed } from "./suppress.ts";

const H = "a".repeat(64);

describe("suppressed entries", () => {
  it("keeps only lowercase 64-hex entry hashes, deduplicated and sorted", () => {
    expect(normalizeSuppressed([H, H, "B".repeat(64), "short", 7, "b".repeat(64)])).toEqual([
      H,
      "b".repeat(64),
    ]);
    expect(normalizeSuppressed({ not: "a list" })).toEqual([]);
  });

  it("round-trips through storage and tolerates a missing or broken file", async () => {
    const store = memoryStore();
    expect(await loadSuppressed(store)).toEqual([]);
    await saveSuppressed(store, [H]);
    expect(await loadSuppressed(store)).toEqual([H]);
    await store.put(SUPPRESS_KEY, "{oops");
    expect(await loadSuppressed(store)).toEqual([]);
  });
});
