import { describe, expect, it } from "vitest";
import { memoryArea } from "./test-utils.ts";
import { listTrusted, readTrusted, setTrusted, TRUSTED_KEY } from "./trusted-sites.ts";

describe("trusted sites", () => {
  it("starts empty", async () => {
    expect((await readTrusted(memoryArea())).size).toBe(0);
  });

  it("trusts and untrusts a site, keyed on its registrable domain", async () => {
    const area = memoryArea();
    await setTrusted(area, "https://www.shop.example/login", true);
    const trusted = await readTrusted(area);
    expect(trusted.has("shop.example")).toBe(true);
    expect(await listTrusted(area)).toEqual(["shop.example"]);

    await setTrusted(area, "https://accounts.shop.example/", false);
    expect((await readTrusted(area)).has("shop.example")).toBe(false);
  });

  it("accepts a bare site key (the popup's trusted list removes by key)", async () => {
    const area = memoryArea();
    await setTrusted(area, "https://a.example/", true);
    await setTrusted(area, "https://b.example/", true);
    await setTrusted(area, "a.example", false);
    expect(await listTrusted(area)).toEqual(["b.example"]);
  });

  it("ignores pages Warden never evaluates", async () => {
    const area = memoryArea();
    await setTrusted(area, "http://localhost:3000/", true);
    await setTrusted(area, "chrome://extensions/", true);
    expect(await listTrusted(area)).toEqual([]);
  });

  it("drops malformed stored data", async () => {
    const area = memoryArea();
    await area.set({ [TRUSTED_KEY]: { "ok.example": 5, 42: "x", "bad key!": 1 } });
    expect(await listTrusted(area)).toEqual(["ok.example"]);
  });
});
