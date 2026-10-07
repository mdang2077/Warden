import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  isStrict,
  normalizePrefs,
  PREFS_KEY,
  readPrefs,
  siteKey,
  siteMode,
  sitesWithMode,
  updatePrefs,
  withSiteMode,
} from "./popup-prefs.ts";
import { memoryArea } from "./test-utils.ts";

describe("siteKey", () => {
  it("keys on the registrable domain of the page", () => {
    expect(siteKey("https://www.streamsite.tv/watch?v=1")).toBe("streamsite.tv");
    expect(siteKey("https://a.github.io/x")).toBe("a.github.io");
  });

  it("falls back to the IP for public IPs and skips pages Warden never evaluates", () => {
    expect(siteKey("http://8.8.8.8/")).toBe("8.8.8.8");
    expect(siteKey("http://localhost:3000/")).toBeNull();
    expect(siteKey("http://192.168.1.1/")).toBeNull();
    expect(siteKey("chrome://extensions/")).toBeNull();
  });
});

describe("popup prefs", () => {
  it("defaults to both protections on and no per-site modes", async () => {
    expect(await readPrefs(memoryArea())).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ phishing: true, hijack: true, sites: {} });
  });

  it("drops malformed stored values", () => {
    expect(
      normalizePrefs({
        phishing: "yes",
        hijack: false,
        sites: { "a.com": "strict", "b.com": "weird", "c.com": "standard" },
      }),
    ).toEqual({ phishing: true, hijack: false, sites: { "a.com": "strict" } });
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it("keeps the three site modes mutually exclusive", () => {
    let prefs = withSiteMode(DEFAULT_PREFS, "a.com", "strict");
    expect(siteMode(prefs, "a.com")).toBe("strict");
    prefs = withSiteMode(prefs, "a.com", "allow");
    expect(siteMode(prefs, "a.com")).toBe("allow");
    expect(sitesWithMode(prefs, "strict")).toEqual([]);
    prefs = withSiteMode(prefs, "a.com", "standard");
    expect(prefs.sites).toEqual({});
    expect(siteMode(prefs, null)).toBe("standard");
  });

  it("only reports strict while popup blocking is on", () => {
    const prefs = withSiteMode(DEFAULT_PREFS, "a.com", "strict");
    expect(isStrict(prefs, "a.com")).toBe(true);
    expect(isStrict({ ...prefs, hijack: false }, "a.com")).toBe(false);
    expect(isStrict(prefs, null)).toBe(false);
  });

  it("persists updates", async () => {
    const area = memoryArea();
    await updatePrefs(area, (p) => withSiteMode({ ...p, phishing: false }, "b.com", "allow"));
    expect((await area.get(PREFS_KEY))[PREFS_KEY]).toEqual({
      phishing: false,
      hijack: true,
      sites: { "b.com": "allow" },
    });
    expect(sitesWithMode(await readPrefs(area), "allow")).toEqual(["b.com"]);
  });
});
