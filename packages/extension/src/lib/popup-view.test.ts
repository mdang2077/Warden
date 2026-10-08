import { describe, expect, it } from "vitest";
import { blockedView, formatAge } from "./popup-view.ts";

describe("formatAge", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatAge(2_400)).toBe("2s");
    expect(formatAge(41_000)).toBe("41s");
    expect(formatAge(3 * 60_000 + 5_000)).toBe("3m");
    expect(formatAge(2 * 3_600_000)).toBe("2h");
    expect(formatAge(-50)).toBe("0s");
  });
});

describe("blockedView", () => {
  it("lists blocks newest first with a summary", () => {
    const view = blockedView(
      {
        siteKey: "stream.example",
        blocks: [
          { destinationHost: "clk.adsrv.example", kind: "redirect", layer: "standard", at: 1_000 },
          { destinationHost: "ad.popnet.example", kind: "new-tab", layer: "strict", at: 40_000 },
        ],
      },
      42_000,
    );
    expect(view).toEqual({
      summary: "Blocked 2 on this page",
      rows: [
        { host: "ad.popnet.example", kind: "new tab", age: "2s" },
        { host: "clk.adsrv.example", kind: "redirect", age: "41s" },
      ],
    });
  });

  it("is null with nothing blocked", () => {
    expect(blockedView(null, 0)).toBeNull();
    expect(blockedView({ siteKey: "a.example", blocks: [] }, 0)).toBeNull();
  });
});
