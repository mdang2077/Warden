import { describe, expect, it } from "vitest";
import {
  appendExperiment,
  createRedirectWatch,
  describeExperiment,
  listExperiments,
  MAX_EXPERIMENTS,
  REDIRECT_WATCH_MS,
} from "./hijack-experiments.ts";
import { memoryArea } from "./test-utils.ts";

function watchSetup() {
  let t = 1_000;
  const w = createRedirectWatch(() => t);
  return {
    w,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("redirect watch (H8)", () => {
  it("logs a clicked link that a server redirect lands on a third site", () => {
    const { w } = watchSetup();
    w.watch(5, "stream.example", "tracker.example", "new-tab");
    expect(w.onCommit(5, "https://casino.example/?click=1", ["server_redirect"])).toEqual({
      at: 1_000,
      experiment: "click-redirect",
      site: "stream.example",
      linkSite: "tracker.example",
      landedSite: "casino.example",
      via: "server",
      kind: "new-tab",
    });
    expect(w.onCommit(5, "https://other.example/", ["server_redirect"])).toBeNull(); // once
  });

  it("logs a script redirect after the clicked site loaded", () => {
    const { w } = watchSetup();
    w.watch(5, "stream.example", "tracker.example", "same-tab");
    expect(w.onCommit(5, "https://tracker.example/landing", [])).toBeNull();
    expect(w.onCommit(5, "https://casino.example/", ["client_redirect"])).toMatchObject({
      landedSite: "casino.example",
      via: "script",
      kind: "same-tab",
    });
  });

  it("ignores landing where the link pointed, back on the strict site, or a navigation the user started", () => {
    const { w } = watchSetup();
    w.watch(5, "stream.example", "news.example", "new-tab");
    expect(w.onCommit(5, "https://www.news.example/story", ["server_redirect"])).toBeNull();
    expect(w.onCommit(5, "https://stream.example/", ["client_redirect"])).toBeNull();
    expect(w.onCommit(5, "https://elsewhere.example/", [])).toBeNull(); // no redirect: user's own
    expect(w.onCommit(5, "https://casino.example/", ["client_redirect"])).toBeNull(); // watch ended
  });

  it("stops watching after the window", () => {
    const { w, advance } = watchSetup();
    w.watch(5, "stream.example", "tracker.example", "new-tab");
    advance(REDIRECT_WATCH_MS + 1);
    expect(w.onCommit(5, "https://casino.example/", ["client_redirect"])).toBeNull();
  });

  it("only watches tabs it was told about", () => {
    const { w } = watchSetup();
    expect(w.onCommit(9, "https://casino.example/", ["server_redirect"])).toBeNull();
  });
});

describe("experiment log", () => {
  it("keeps the newest entries up to the cap", async () => {
    const area = memoryArea();
    for (let i = 0; i < MAX_EXPERIMENTS + 3; i++) {
      await appendExperiment(area, {
        at: i,
        experiment: "download",
        site: "a.example",
        downloadSite: "b.example",
        fileType: "exe",
        reason: "installer",
      });
    }
    const list = await listExperiments(area);
    expect(list).toHaveLength(MAX_EXPERIMENTS);
    expect(list[0]?.at).toBe(3);
  });
});

describe("describeExperiment", () => {
  it("says what the stricter rule would have stopped, in plain words", () => {
    expect(
      describeExperiment({
        at: 0,
        experiment: "click-redirect",
        site: "stream.example",
        linkSite: "tracker.example",
        landedSite: "casino.example",
        via: "server",
        kind: "new-tab",
      }),
    ).toBe("stream.example: clicked a link to tracker.example, landed on casino.example");
    expect(
      describeExperiment({
        at: 0,
        experiment: "download",
        site: "stream.example",
        downloadSite: "cdn.example",
        fileType: "exe",
        reason: "installer",
      }),
    ).toBe("stream.example: .exe installer from cdn.example");
    expect(
      describeExperiment({
        at: 0,
        experiment: "download",
        site: "stream.example",
        downloadSite: "files.example",
        fileType: "",
        reason: "no-click",
      }),
    ).toBe("stream.example: download from files.example you didn't click");
  });
});
