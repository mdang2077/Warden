/**
 * Hijack guard experiments, log-only: what a stricter rule *would* have
 * blocked, recorded on this device so the rules can be judged on real browsing before they
 * act. Nothing here closes a tab or cancels a download.
 *
 * - H8 "click-redirect": on a strict site, the user clicked a visible link to site A (so
 *   strict mode allowed it), and within REDIRECT_WATCH_MS a server or script redirect took
 *   the tab to a third site C. Link shorteners and outbound-link trackers do this too, which
 *   is why it only logs.
 * - H9 "download": a download a strict site started without a click on a visible link to
 *   the file's site, or an installer-type file from a different site than the page.
 *
 * Entries hold site names, file types and times only, never full URLs.
 */
import { registrableDomain } from "@warden/shared/psl";
import type { KeyValueArea } from "./overrides.ts";

export const REDIRECT_WATCH_MS = 10_000;
export const MAX_EXPERIMENTS = 500;
const KEY = "hijack_experiments";

export type ExperimentEntry =
  | {
      at: number;
      experiment: "click-redirect";
      /** The strict site the click happened on. */
      site: string;
      linkSite: string;
      landedSite: string;
      via: "server" | "script";
      kind: "new-tab" | "same-tab";
    }
  | {
      at: number;
      experiment: "download";
      /** The page that started the download. */
      site: string;
      downloadSite: string;
      /** Lowercase file extension, or "" when unknown. */
      fileType: string;
      reason: "no-click" | "installer";
    };

function siteOf(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.startsWith("blob:") ? rawUrl.slice(5) : rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return registrableDomain(url.hostname) ?? url.hostname;
  } catch {
    return null;
  }
}

export function createRedirectWatch(now: () => number = Date.now) {
  const watched = new Map<
    number,
    { site: string; linkSite: string; kind: "new-tab" | "same-tab"; until: number }
  >();
  return {
    /** Strict mode allowed a navigation in `tabId` because of a click on a link to `linkSite`. */
    watch(tabId: number, site: string, linkSite: string, kind: "new-tab" | "same-tab"): void {
      watched.set(tabId, { site, linkSite, kind, until: now() + REDIRECT_WATCH_MS });
    },

    /** Every top-frame commit; returns an entry when a watched tab was redirected elsewhere. */
    onCommit(tabId: number, url: string, qualifiers: readonly string[]): ExperimentEntry | null {
      const w = watched.get(tabId);
      if (!w) return null;
      if (now() > w.until) {
        watched.delete(tabId);
        return null;
      }
      const landed = siteOf(url);
      const server = qualifiers.includes("server_redirect");
      const script = qualifiers.includes("client_redirect");
      if (landed === w.site || landed === w.linkSite || landed === null) {
        // The page the link pointed to loaded; a script may still redirect it, so keep watching.
        return null;
      }
      watched.delete(tabId);
      if (!server && !script) return null; // the user navigated somewhere themselves
      return {
        at: now(),
        experiment: "click-redirect",
        site: w.site,
        linkSite: w.linkSite,
        landedSite: landed,
        via: script ? "script" : "server",
        kind: w.kind,
      };
    },

    forget(tabId: number): void {
      watched.delete(tabId);
    },
  };
}

const INSTALLER = /\.(exe|msi|msix|appx|dmg|pkg|apk|scr|bat|cmd|com|jar|vbs|ps1)$/i;

export function downloadExperiment(
  item: { at: number; url: string; referrer: string; filename: string },
  ctx: {
    /** The page that started the download is on a strict site. */
    strict: boolean;
    /** Sites of visible links the user clicked in the last second, any tab. */
    clickedLinkSites: readonly string[];
  },
): ExperimentEntry | null {
  const site = siteOf(item.referrer) ?? siteOf(item.url);
  const downloadSite = item.url.startsWith("blob:") ? site : siteOf(item.url);
  if (!site || !downloadSite) return null;
  let name = item.filename;
  if (!name) {
    try {
      name = new URL(item.url.startsWith("blob:") ? item.url.slice(5) : item.url).pathname;
    } catch {
      name = "";
    }
  }
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const base = { at: item.at, experiment: "download" as const, site, downloadSite, fileType: ext };
  if (ctx.strict && downloadSite !== site && !ctx.clickedLinkSites.includes(downloadSite)) {
    return { ...base, reason: "no-click" };
  }
  if (downloadSite !== site && INSTALLER.test(name)) return { ...base, reason: "installer" };
  return null;
}

export async function appendExperiment(area: KeyValueArea, entry: ExperimentEntry): Promise<void> {
  const log = ((await area.get(KEY))[KEY] as ExperimentEntry[] | undefined) ?? [];
  await area.set({ [KEY]: [...log, entry].slice(-MAX_EXPERIMENTS) });
}

export async function listExperiments(area: KeyValueArea): Promise<ExperimentEntry[]> {
  return ((await area.get(KEY))[KEY] as ExperimentEntry[] | undefined) ?? [];
}

/** One line for the popup's experiments list (site names come from pages: render as text). */
export function describeExperiment(e: ExperimentEntry): string {
  if (e.experiment === "click-redirect") {
    return `${e.site}: clicked a link to ${e.linkSite}, landed on ${e.landedSite}`;
  }
  return e.reason === "installer"
    ? `${e.site}: .${e.fileType} installer from ${e.downloadSite}`
    : `${e.site}: download from ${e.downloadSite} you didn't click`;
}
