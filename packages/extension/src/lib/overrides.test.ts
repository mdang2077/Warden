import { describe, expect, it } from "vitest";
import { createOverrideStore } from "./overrides.ts";
import { memoryArea } from "./test-utils.ts";

describe("override store", () => {
  it("bypasses only the exact URL the user clicked through", async () => {
    const store = createOverrideStore(memoryArea());
    await store.addBypass("https://phish.example/login", ["openphish"]);
    expect(await store.isBypassed("https://phish.example/login", ["openphish"])).toBe(true);
    expect(await store.isBypassed("https://phish.example/login#x", ["openphish"])).toBe(true);
    expect(await store.isBypassed("https://phish.example/other", ["openphish"])).toBe(false);
    expect(await store.isBypassed("https://phish.example/", ["openphish"])).toBe(false);
  });

  it("never hides a Safe Browsing hit the user didn't click through", async () => {
    const store = createOverrideStore(memoryArea());
    await store.addBypass("https://phish.example/login", ["openphish"]);
    expect(
      await store.isBypassed("https://phish.example/login", ["openphish", "safe_browsing"]),
    ).toBe(false);
    expect(await store.isBypassed("https://phish.example/login", ["safe_browsing"])).toBe(false);
  });

  it("hides a Safe Browsing hit after an explicit click-through", async () => {
    const store = createOverrideStore(memoryArea());
    await store.addBypass("https://phish.example/login", ["safe_browsing"]);
    expect(await store.isBypassed("https://phish.example/login", ["safe_browsing"])).toBe(true);
  });

  it("accumulates sources across click-throughs", async () => {
    const store = createOverrideStore(memoryArea());
    await store.addBypass("https://phish.example/", ["openphish"]);
    await store.addBypass("https://phish.example/", ["safe_browsing"]);
    expect(await store.isBypassed("https://phish.example/", ["openphish", "safe_browsing"])).toBe(
      true,
    );
  });

  it("treats a block with no known sources as not bypassed", async () => {
    const store = createOverrideStore(memoryArea());
    await store.addBypass("https://phish.example/", ["openphish"]);
    expect(await store.isBypassed("https://phish.example/", [])).toBe(false);
  });
});
