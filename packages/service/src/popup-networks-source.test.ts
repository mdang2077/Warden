import { bundledPopupNetworksFile } from "@warden/shared/popup-networks";
import { describe, expect, it, vi } from "vitest";
import {
  buildPopupNetworks,
  EASYLIST_URL,
  extractPopupDomains,
  refreshPopupNetworks,
} from "./popup-networks-source.ts";
import { memoryStore } from "./storage.ts";

const DAY = 24 * 60 * 60_000;

describe("extractPopupDomains", () => {
  it("keeps only domain-anchored $popup rules DNR can express", () => {
    const text = [
      "[Adblock Plus 2.0]",
      "! a comment",
      "||popads.net^$popup",
      "||clk.adnet.example^$popup,third-party",
      "||UPPER.Example^$popup",
      "||popads.net^$popup",
      "||banner.example^$third-party",
      "||pathy.example/ads^$popup",
      "||wild*.example^$popup",
      "||scoped.example^$popup,domain=site.example",
      "||com^$popup",
      "@@||allowed.example^$popup",
      "example.org##.ad",
    ].join("\n");
    expect(extractPopupDomains(text)).toEqual(["clk.adnet.example", "popads.net", "upper.example"]);
  });
});

describe("buildPopupNetworks", () => {
  it("merges EasyList and the curated list, with attribution", () => {
    const file = buildPopupNetworks(["b.example", "a.example"], ["a.example", "c.example"], 1_000);
    expect(file.domains).toEqual(["a.example", "b.example", "c.example"]);
    expect(file.version).toBe(1_000);
    expect(file.sources.map((s) => s.name)).toEqual(["EasyList", "Warden curated"]);
  });
});

describe("refreshPopupNetworks", () => {
  const easylist = Array.from({ length: 30 }, (_, i) => `||pop${i}.example^$popup`).join("\n");
  const ok = () => vi.fn(async (_url: string) => new Response(easylist));

  it("builds and stores the list, then reuses it for a day", async () => {
    const store = memoryStore();
    const f = ok();
    const first = await refreshPopupNetworks(store, f as unknown as typeof fetch, 1_000);
    expect(first.refreshed).toBe(true);
    expect(f).toHaveBeenCalledWith(EASYLIST_URL);
    expect(first.file?.domains).toContain("pop0.example");
    for (const d of bundledPopupNetworksFile.domains) expect(first.file?.domains).toContain(d);

    const second = await refreshPopupNetworks(store, f as unknown as typeof fetch, 1_000 + DAY - 1);
    expect(second.refreshed).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(second.file).toEqual(first.file);
  });

  it("keeps the last good list when a refresh fails", async () => {
    const store = memoryStore();
    await refreshPopupNetworks(store, ok() as unknown as typeof fetch, 1_000);
    const down = vi.fn(async () => new Response("", { status: 503 }));
    const out = await refreshPopupNetworks(store, down as unknown as typeof fetch, 1_000 + DAY);
    expect(out.refreshed).toBe(false);
    expect(out.error).toMatch(/503/);
    expect(out.file?.domains).toContain("pop0.example");
  });

  it("rejects a suspiciously short EasyList and reports no file if none was ever built", async () => {
    const tiny = vi.fn(async () => new Response("||one.example^$popup"));
    const out = await refreshPopupNetworks(memoryStore(), tiny as unknown as typeof fetch, 1_000);
    expect(out.file).toBeNull();
    expect(out.error).toMatch(/too few/);
  });
});
