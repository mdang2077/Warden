import { describe, expect, it } from "vitest";
import {
  CONFIG_KEY,
  DEFAULT_FEED_CONFIG,
  enabledFeeds,
  loadConfig,
  normalizeConfig,
  saveConfig,
} from "./config.ts";
import { memoryStore } from "./storage.ts";

describe("feed config", () => {
  it("defaults to OpenPhish only, Tier B feeds disabled", async () => {
    const config = await loadConfig(memoryStore());
    expect(config).toEqual(DEFAULT_FEED_CONFIG);
    expect(enabledFeeds(config)).toEqual(["openphish"]);
  });

  it("applies valid fields and ignores invalid ones", () => {
    expect(
      normalizeConfig({
        openphish: { enabled: false },
        phishing_database: { enabled: true, tier: "Z" },
        phishstats: "nope",
        bogus: { enabled: true },
      }),
    ).toEqual({
      openphish: { enabled: false, tier: "A" },
      phishing_database: { enabled: true, tier: "B" },
      phishstats: { enabled: false, tier: "B" },
      cert_pl: { enabled: false, tier: "B" },
    });
  });

  it("falls back to defaults on unreadable JSON", async () => {
    const store = memoryStore();
    await store.put(CONFIG_KEY, "{not json");
    expect(await loadConfig(store)).toEqual(DEFAULT_FEED_CONFIG);
  });

  it("round-trips through the store", async () => {
    const store = memoryStore();
    await saveConfig(store, { openphish: { enabled: false, tier: "A" } });
    expect((await loadConfig(store)).openphish.enabled).toBe(false);
  });
});
