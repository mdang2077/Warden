import { describe, expect, it } from "vitest";
import { type DownloadInfo, isInstaller, judgeDownload } from "./download-guard.ts";

const dl = (over: Partial<DownloadInfo> = {}): DownloadInfo => ({
  url: "https://cdn.other.example/setup.exe",
  finalUrl: "https://cdn.other.example/setup.exe",
  referrer: "https://news.example/article",
  filename: "",
  mime: "",
  ...over,
});
const standard = { mode: "standard" as const, clickedLinkSites: [] };

describe("judgeDownload", () => {
  it("pauses an installer from another site the user didn't click a link to", () => {
    expect(judgeDownload(dl(), standard)).toEqual({
      pause: true,
      reason: "installer",
      site: "news.example",
      fileSite: "other.example",
      fileType: "exe",
    });
  });

  it("pauses when a click on one link lands on an installer elsewhere (tracker redirect)", () => {
    const d = dl({ url: "https://track.ads.example/c?id=1" });
    const v = judgeDownload(d, { mode: "standard", clickedLinkSites: ["ads.example"] });
    expect(v).toMatchObject({ pause: true, reason: "installer", fileSite: "other.example" });
  });

  it("allows an installer the user clicked a visible link to", () => {
    expect(judgeDownload(dl(), { mode: "standard", clickedLinkSites: ["other.example"] })).toEqual({
      pause: false,
    });
  });

  it("allows a site's own download link that redirects to its CDN", () => {
    const d = dl({
      url: "https://github.com/o/r/releases/download/v1/app.dmg",
      finalUrl: "https://objects.githubusercontent.com/x/app.dmg",
      referrer: "https://github.com/o/r/releases",
    });
    expect(judgeDownload(d, { mode: "standard", clickedLinkSites: ["github.com"] }).pause).toBe(
      false,
    );
    // Even when the click wasn't recorded, outside strict mode.
    expect(judgeDownload(d, standard).pause).toBe(false);
  });

  it("allows same-site files, and files the page made itself", () => {
    expect(
      judgeDownload(dl({ url: "https://dl.news.example/a.exe", finalUrl: "" }), standard),
    ).toEqual({
      pause: false,
    });
    expect(
      judgeDownload(dl({ url: "blob:https://news.example/1", finalUrl: "" }), standard).pause,
    ).toBe(false);
  });

  it("allows non-installers outside strict mode", () => {
    const d = dl({ url: "https://cdn.other.example/report.pdf", finalUrl: "" });
    expect(judgeDownload(d, standard).pause).toBe(false);
  });

  it("on strict sites, pauses any file from another site without a click", () => {
    const d = dl({ url: "https://cdn.other.example/report.pdf", finalUrl: "" });
    expect(judgeDownload(d, { mode: "strict", clickedLinkSites: [] })).toMatchObject({
      pause: true,
      reason: "no-click",
      fileType: "pdf",
    });
    expect(judgeDownload(d, { mode: "strict", clickedLinkSites: ["other.example"] }).pause).toBe(
      false,
    );
  });

  it("never acts on allowed sites or downloads no page started", () => {
    expect(judgeDownload(dl(), { mode: "allow", clickedLinkSites: [] }).pause).toBe(false);
    expect(judgeDownload(dl({ referrer: "" }), standard).pause).toBe(false);
  });
});

describe("isInstaller", () => {
  it("knows installers by extension in the name or URL, and by type", () => {
    expect(
      isInstaller({
        url: "https://a.example/x",
        finalUrl: "",
        filename: "C:\\D\\Setup.EXE",
        mime: "",
      }),
    ).toBe(true);
    expect(
      isInstaller({ url: "https://a.example/app.apk?x=1", finalUrl: "", filename: "", mime: "" }),
    ).toBe(true);
    expect(
      isInstaller({
        url: "https://a.example/get",
        finalUrl: "",
        filename: "",
        mime: "application/x-msdownload",
      }),
    ).toBe(true);
    expect(
      isInstaller({
        url: "https://a.example/doc.pdf",
        finalUrl: "",
        filename: "",
        mime: "application/pdf",
      }),
    ).toBe(false);
  });
});
