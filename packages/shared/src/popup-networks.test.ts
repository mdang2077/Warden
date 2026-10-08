import { describe, expect, it } from "vitest";
import {
  bundledPopupNetworks,
  isPopupNetworkUrl,
  loadPopupNetworks,
  type PopupNetworksFile,
} from "./popup-networks.ts";

const file = (domains: unknown[], version = 1) =>
  ({ version, generatedAt: "2026-10-06T00:00:00Z", sources: [], domains }) as PopupNetworksFile;

describe("popup-network list", () => {
  it("matches a listed domain and its subdomains, not lookalikes", () => {
    const list = loadPopupNetworks(file(["popads.net"]));
    expect(list.has("popads.net")).toBe(true);
    expect(list.has("c1.popads.net")).toBe(true);
    expect(list.has("POPADS.NET.")).toBe(true);
    expect(list.has("notpopads.net")).toBe(false);
    expect(list.has("popads.net.evil.example")).toBe(false);
  });

  it("dedupes and sorts domains", () => {
    const list = loadPopupNetworks(file(["b.example", "a.example", "b.example"]));
    expect(list.domains).toEqual(["a.example", "b.example"]);
  });

  it("rejects a bad version or a malformed domain", () => {
    expect(() => loadPopupNetworks(file(["ok.example"], 0))).toThrow(/version/);
    expect(() => loadPopupNetworks(file(["*.wild.example"]))).toThrow(/domain/);
    expect(() => loadPopupNetworks(file(["has/path.example"]))).toThrow(/domain/);
    expect(() => loadPopupNetworks(file(["nodot"]))).toThrow(/domain/);
    expect(() => loadPopupNetworks(file([42]))).toThrow(/domain/);
  });

  it("checks only http(s) URLs", () => {
    const list = loadPopupNetworks(file(["popads.net"]));
    expect(isPopupNetworkUrl(list, "https://c.popads.net/x?y=1")).toBe(true);
    expect(isPopupNetworkUrl(list, "http://popads.net/")).toBe(true);
    expect(isPopupNetworkUrl(list, "ftp://popads.net/")).toBe(false);
    expect(isPopupNetworkUrl(list, "not a url")).toBe(false);
    expect(isPopupNetworkUrl(list, "https://example.com/?u=popads.net")).toBe(false);
  });

  it("ships a valid, non-empty bundled fallback", () => {
    expect(bundledPopupNetworks.version).toBeGreaterThanOrEqual(1);
    expect(bundledPopupNetworks.domains.length).toBeGreaterThan(0);
  });
});
