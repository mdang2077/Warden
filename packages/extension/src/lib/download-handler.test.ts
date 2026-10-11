import { describe, expect, it, vi } from "vitest";
import { createDownloadHandler, type DownloadHandlerDeps, PAUSED_KEY } from "./download-handler.ts";
import { DOWNLOAD_CHOICE } from "./download-prompt.ts";
import { memoryArea } from "./test-utils.ts";

const forced = {
  id: 5,
  url: "https://cdn.other.example/setup.exe",
  referrer: "https://news.example/a",
  state: "in_progress",
};

function setup(over: Partial<DownloadHandlerDeps> = {}) {
  const downloads = {
    pause: vi.fn(async (_id: number) => {}),
    resume: vi.fn(async (_id: number) => {}),
    cancel: vi.fn(async (_id: number) => {}),
    removeFile: vi.fn(async (_id: number) => {}),
    erase: vi.fn(async (_q: { id: number }) => []),
    search: vi.fn(async (_q: { id: number }) => [{ state: "in_progress" }]),
  };
  const ask = vi.fn(async (_tabId: number, _m: { id: number; text: string }) => true);
  const log = vi.fn(async () => {});
  const session = memoryArea();
  const deps: DownloadHandlerDeps = {
    downloads,
    session,
    modeFor: async () => "standard",
    clickedLinkSites: () => [],
    tabsOnSite: async () => [11, 12],
    ask,
    log,
    now: () => 1_000,
    ...over,
  };
  return { handler: createDownloadHandler(deps), downloads, ask, log, session };
}

describe("download handler", () => {
  it("pauses a forced installer, logs it, and asks on the first tab that takes it", async () => {
    const { handler, downloads, ask, log } = setup();
    expect(await handler.onCreated(forced)).toBe("paused");
    expect(downloads.pause).toHaveBeenCalledWith(5);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.[0]).toBe(11);
    expect(ask.mock.calls[0]?.[1]).toMatchObject({
      id: 5,
      text: expect.stringContaining("other.example"),
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ experiment: "download", reason: "installer", action: "paused" }),
    );
  });

  it("tries the next tab when one can't show the prompt, and stays paused when none can", async () => {
    const ask = vi.fn(async (tabId: number) => tabId === 12);
    const { handler } = setup({ ask });
    await handler.onCreated(forced);
    expect(ask.mock.calls.map((c) => c[0])).toEqual([11, 12]);
    const none = setup({ ask: async () => false });
    expect(await none.handler.onCreated(forced)).toBe("paused");
    expect(none.downloads.cancel).not.toHaveBeenCalled();
  });

  it("leaves alone what the guard allows, and everything when it is off", async () => {
    const clicked = setup({ clickedLinkSites: () => ["other.example"] });
    expect(await clicked.handler.onCreated(forced)).toBe("allowed");
    expect(clicked.downloads.pause).not.toHaveBeenCalled();
    const off = setup({ modeFor: async () => "off" });
    expect(await off.handler.onCreated(forced)).toBe("allowed");
  });

  it("resumes on Keep and cancels and erases on Cancel", async () => {
    const { handler, downloads, session } = setup();
    await handler.onCreated(forced);
    expect(await handler.onChoice({ type: DOWNLOAD_CHOICE, id: 5, keep: true })).toBe(true);
    expect(downloads.resume).toHaveBeenCalledWith(5);
    expect((await session.get(PAUSED_KEY))[PAUSED_KEY]).toEqual([]);

    await handler.onCreated(forced);
    await handler.onChoice({ type: DOWNLOAD_CHOICE, id: 5, keep: false });
    expect(downloads.cancel).toHaveBeenCalledWith(5);
    expect(downloads.erase).toHaveBeenCalledWith({ id: 5 });
  });

  it("deletes a file that finished before it could be paused, when the user cancels", async () => {
    const { handler, downloads, log } = setup();
    downloads.pause.mockRejectedValueOnce(new Error("Download must be in progress"));
    downloads.search.mockResolvedValueOnce([{ state: "complete" }]);
    await handler.onCreated(forced);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: "finished" }));
    await handler.onChoice({ type: DOWNLOAD_CHOICE, id: 5, keep: false });
    expect(downloads.removeFile).toHaveBeenCalledWith(5);
    expect(downloads.cancel).not.toHaveBeenCalled();
  });

  it("ignores answers for downloads it didn't pause", async () => {
    const { handler, downloads } = setup();
    expect(await handler.onChoice({ type: DOWNLOAD_CHOICE, id: 99, keep: false })).toBe(false);
    expect(downloads.cancel).not.toHaveBeenCalled();
  });
});
