import { describe, expect, it } from "vitest";
import { createRedirectTracker } from "./redirects.ts";

describe("redirect tracker", () => {
  it("records server redirect hops for one request", () => {
    const t = createRedirectTracker();
    t.startRequest(1, "r1", "https://link.example/c?id=9");
    expect(t.redirect(1, "r1", "https://link.example/c?id=9", "https://hop.example/")).toEqual([
      "https://link.example/c?id=9",
    ]);
    expect(t.redirect(1, "r1", "https://hop.example/", "https://phish.example/")).toEqual([
      "https://link.example/c?id=9",
      "https://hop.example/",
    ]);
    expect(t.chainFor(1, "https://phish.example/")).toEqual([
      "https://link.example/c?id=9",
      "https://hop.example/",
    ]);
  });

  it("starts a fresh chain for a new request and keeps tabs apart", () => {
    const t = createRedirectTracker();
    t.startRequest(1, "r1", "https://a.example/");
    t.redirect(1, "r1", "https://a.example/", "https://b.example/");
    t.startRequest(1, "r2", "https://c.example/");
    expect(t.chainFor(1, "https://c.example/")).toEqual([]);
    t.startRequest(2, "r3", "https://x.example/");
    expect(t.chainFor(2, "https://x.example/")).toEqual([]);
  });

  it("returns no chain when the event URL isn't the latest hop", () => {
    const t = createRedirectTracker();
    t.startRequest(1, "r1", "https://a.example/");
    t.redirect(1, "r1", "https://a.example/", "https://b.example/");
    expect(t.chainFor(1, "https://other.example/")).toEqual([]);
  });

  it("continues the chain through a client redirect", () => {
    const t = createRedirectTracker();
    t.startRequest(1, "r1", "https://link.example/");
    t.redirect(1, "r1", "https://link.example/", "https://landing.example/");
    t.commit(1, "https://landing.example/", t.chainFor(1, "https://landing.example/"));

    t.startRequest(1, "r2", "https://phish.example/");
    expect(t.chainFor(1, "https://phish.example/", true)).toEqual([
      "https://link.example/",
      "https://landing.example/",
    ]);
    expect(t.chainFor(1, "https://phish.example/", false)).toEqual([]);
  });

  it("caps long chains, keeping the first hop", () => {
    const t = createRedirectTracker();
    t.startRequest(1, "r1", "https://h0.example/");
    for (let i = 1; i <= 30; i++) {
      t.redirect(1, "r1", `https://h${i - 1}.example/`, `https://h${i}.example/`);
    }
    const chain = t.chainFor(1, "https://h30.example/");
    expect(chain.length).toBeLessThanOrEqual(19);
    expect(chain[0]).toBe("https://h0.example/");
  });

  it("forgets closed tabs", () => {
    const t = createRedirectTracker();
    t.startRequest(1, "r1", "https://a.example/");
    t.redirect(1, "r1", "https://a.example/", "https://b.example/");
    t.forgetTab(1);
    expect(t.chainFor(1, "https://b.example/")).toEqual([]);
  });
});
