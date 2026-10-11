/**
 * Forced downloads (H9), the worker side: judge each new download (download-guard.ts),
 * pause it when it looks forced, ask on the page that started it (download-prompt.ts), and
 * resume or cancel on the user's answer. Paused ids live in session storage, so an answer
 * still counts after the worker restarts. Without a page to ask on, the download simply
 * stays paused in Chrome's download list, where the user can resume it.
 */

import { type DownloadInfo, judgeDownload } from "./download-guard.ts";
import { askText, DOWNLOAD_ASK, type DownloadChoice } from "./download-prompt.ts";
import type { ExperimentEntry } from "./hijack-experiments.ts";
import type { KeyValueArea } from "./overrides.ts";

export const PAUSED_KEY = "downloads_paused";

export interface DownloadItemLike {
  id: number;
  url: string;
  finalUrl?: string;
  referrer?: string;
  filename?: string;
  mime?: string;
  state?: string;
}

export interface DownloadHandlerDeps {
  downloads: {
    pause(id: number): Promise<void>;
    resume(id: number): Promise<void>;
    cancel(id: number): Promise<void>;
    removeFile(id: number): Promise<void>;
    erase(query: { id: number }): Promise<unknown>;
    search(query: { id: number }): Promise<{ state?: string }[]>;
  };
  /** Session storage: paused ids survive a worker restart, not a browser restart. */
  session: KeyValueArea;
  /** Off when the hijack guard is off; otherwise the page site's mode. */
  modeFor(pageUrl: string): Promise<"off" | "allow" | "standard" | "strict">;
  clickedLinkSites(): string[];
  /** Tabs showing a page on `site`, best candidate first. */
  tabsOnSite(site: string): Promise<number[]>;
  /** Shows the prompt in the tab; false when no page there could take it. */
  ask(
    tabId: number,
    message: { type: typeof DOWNLOAD_ASK; id: number; text: string },
  ): Promise<boolean>;
  log(entry: ExperimentEntry): Promise<void>;
  now?: () => number;
}

async function pausedIds(area: KeyValueArea): Promise<number[]> {
  return ((await area.get(PAUSED_KEY))[PAUSED_KEY] as number[] | undefined) ?? [];
}

export function createDownloadHandler(deps: DownloadHandlerDeps) {
  const now = deps.now ?? Date.now;

  return {
    async onCreated(item: DownloadItemLike): Promise<"paused" | "allowed"> {
      const info: DownloadInfo = {
        url: item.url,
        finalUrl: item.finalUrl ?? "",
        referrer: item.referrer ?? "",
        filename: item.filename ?? "",
        mime: item.mime ?? "",
      };
      const mode = info.referrer ? await deps.modeFor(info.referrer) : "off";
      if (mode === "off") return "allowed";
      const verdict = judgeDownload(info, { mode, clickedLinkSites: deps.clickedLinkSites() });
      if (!verdict.pause) return "allowed";

      // Pause first: every await before it lets more of the file arrive.
      const paused = await deps.downloads.pause(item.id).then(
        () => true,
        () => false, // already finished (a small file): the user can still delete it
      );
      await deps.session.set({ [PAUSED_KEY]: [...(await pausedIds(deps.session)), item.id] });
      await deps
        .log({
          at: now(),
          experiment: "download",
          site: verdict.site,
          downloadSite: verdict.fileSite,
          fileType: verdict.fileType,
          reason: verdict.reason,
          action: paused ? "paused" : "finished",
        })
        .catch(() => {});
      const text = askText(verdict);
      for (const tabId of await deps.tabsOnSite(verdict.site)) {
        if (await deps.ask(tabId, { type: DOWNLOAD_ASK, id: item.id, text }).catch(() => false))
          break;
      }
      return "paused";
    },

    /** The user's answer from the page. Ignores ids Warden didn't pause. */
    async onChoice(choice: DownloadChoice): Promise<boolean> {
      const ids = await pausedIds(deps.session);
      if (!ids.includes(choice.id)) return false;
      await deps.session.set({ [PAUSED_KEY]: ids.filter((i) => i !== choice.id) });
      if (choice.keep) {
        await deps.downloads.resume(choice.id).catch(() => {}); // a finished file needs nothing
        return true;
      }
      const [item] = await deps.downloads.search({ id: choice.id }).catch(() => []);
      if (item?.state === "complete") await deps.downloads.removeFile(choice.id).catch(() => {});
      else await deps.downloads.cancel(choice.id).catch(() => {});
      await deps.downloads.erase({ id: choice.id }).catch(() => {});
      return true;
    },
  };
}
