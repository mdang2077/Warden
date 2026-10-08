import { describe, expect, it } from "vitest";
import { buildWarningUrl, parseWarningParams } from "./interstitial.ts";

const PAGE = "chrome-extension://abc/warning.html";

describe("interstitial params", () => {
  it("round-trips the blocked URL and sources", () => {
    const href = buildWarningUrl(PAGE, {
      url: "https://phish.example/a?b=c&d=e#f",
      sources: ["openphish", "safe_browsing"],
    });
    expect(parseWarningParams(new URL(href).search)).toEqual({
      url: "https://phish.example/a?b=c&d=e#f",
      sources: ["openphish", "safe_browsing"],
    });
  });

  it.each([
    "",
    "?u=",
    "?u=not%20a%20url",
    "?u=javascript%3Aalert(1)",
    "?u=data%3Atext%2Fhtml%2Chi",
    "?u=chrome%3A%2F%2Fsettings",
  ])("rejects %s", (search) => {
    expect(parseWarningParams(search)).toBeNull();
  });

  it("carries the originating link of a redirect chain", () => {
    const href = buildWarningUrl(PAGE, {
      url: "https://phish.example/",
      sources: ["openphish"],
      origin: "https://news.example/out?id=1",
    });
    expect(parseWarningParams(new URL(href).search)?.origin).toBe("https://news.example/out?id=1");
  });

  it("drops an origin that is unsafe or the same as the blocked URL", () => {
    const base = "?u=https%3A%2F%2Fx.example%2F&s=openphish";
    expect(parseWarningParams(`${base}&o=javascript%3Aalert(1)`)?.origin).toBeUndefined();
    expect(parseWarningParams(`${base}&o=https%3A%2F%2Fx.example%2F`)?.origin).toBeUndefined();
    const same = buildWarningUrl(PAGE, {
      url: "https://x.example/",
      sources: [],
      origin: "https://x.example/",
    });
    expect(new URL(same).searchParams.has("o")).toBe(false);
  });

  it("drops unknown and non-blocking sources", () => {
    const parsed = parseWarningParams("?u=https%3A%2F%2Fx.example%2F&s=openphish,bogus,allowlist");
    expect(parsed?.sources).toEqual(["openphish"]);
  });
});
