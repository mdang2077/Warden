import { describe, expect, it } from "vitest";
import { buildWarningUrl, parseWarningParams, reportIssueUrl } from "./interstitial.ts";

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

describe("reportIssueUrl", () => {
  it("opens the wrong-block issue form with the page pre-filled, minus query and fragment", () => {
    const url = new URL(
      reportIssueUrl("https://shop.example/login?token=SECRET#step2", [
        "openphish",
        "safe_browsing",
      ]),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/mdang2077/Warden/issues/new");
    expect(url.searchParams.get("template")).toBe("false-positive.yml");
    expect(url.searchParams.get("url")).toBe("https://shop.example/login");
    expect(url.searchParams.get("sources")).toBe("OpenPhish, Google Safe Browsing");
    expect(url.href).not.toContain("SECRET");
  });

  it("leaves the page empty for something that isn't a web address", () => {
    expect(new URL(reportIssueUrl("not a url", [])).searchParams.get("url")).toBe("");
  });
});
