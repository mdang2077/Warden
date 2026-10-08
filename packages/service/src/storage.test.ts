import { describe, expect, it } from "vitest";
import { memoryStore, prefixedStore } from "./storage.ts";

describe("prefixedStore", () => {
  it("keeps every key under the prefix and hides it from callers", async () => {
    const base = memoryStore();
    const dev = prefixedStore(base, "dev/");
    await dev.put("v1/manifest.json", "{}");
    expect([...base.data.keys()]).toEqual(["dev/v1/manifest.json"]);
    expect(await dev.get("v1/manifest.json")).toBe("{}");
    expect(await dev.list("v1/")).toEqual(["v1/manifest.json"]);
    await base.put("v1/manifest.json", "prod");
    expect(await dev.list("v1/")).toEqual(["v1/manifest.json"]);
    await dev.delete("v1/manifest.json");
    expect([...base.data.keys()]).toEqual(["v1/manifest.json"]);
  });
});
