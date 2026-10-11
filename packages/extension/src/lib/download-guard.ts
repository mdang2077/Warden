/**
 * Hijack guard, forced downloads (H9): should Warden pause a download and ask? Pure, so
 * every case is unit-tested. A download is paused when the file comes from another site
 * than the page, the user didn't just click a visible link to it, and it's either an
 * installer type (anywhere) or any file on a strict site. The user then chooses Keep or
 * Cancel; nothing is ever cancelled without asking.
 *
 * When unsure it allows: a lost click record must never hold up a file the user asked for.
 */
import { registrableDomain } from "@warden/shared/psl";

/** A click this recent on a link to the file's site counts as asking for it (slow servers). */
export const DOWNLOAD_CLICK_WINDOW_MS = 5_000;

const INSTALLER_EXT =
  /\.(exe|msi|msix|msixbundle|appx|appxbundle|dmg|pkg|mpkg|apk|xapk|scr|bat|cmd|com|jar|vbs|vbe|js|jse|wsf|ps1|lnk|hta|iso|img)$/i;
const INSTALLER_MIME = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-ms-installer",
  "application/x-msi",
  "application/vnd.microsoft.portable-executable",
  "application/x-apple-diskimage",
  "application/vnd.android.package-archive",
  "application/java-archive",
]);

export interface DownloadInfo {
  /** The URL the download was requested from (before redirects). */
  url: string;
  /** Where the file actually came from (after redirects); may equal `url`. */
  finalUrl: string;
  /** The page that started it; empty for typed URLs and the downloads page. */
  referrer: string;
  filename: string;
  mime: string;
}

export interface DownloadContext {
  /** Site mode of the page that started the download. */
  mode: "allow" | "standard" | "strict";
  /** Sites of visible links the user clicked within DOWNLOAD_CLICK_WINDOW_MS, any tab. */
  clickedLinkSites: readonly string[];
}

export type DownloadVerdict =
  | { pause: false }
  | {
      pause: true;
      reason: "installer" | "no-click";
      site: string;
      fileSite: string;
      fileType: string;
    };

function siteOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return registrableDomain(url.hostname) ?? url.hostname;
  } catch {
    return null;
  }
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return "";
  }
}

const extOf = (name: string) => /\.([a-z0-9]{1,11})$/i.exec(name)?.[1]?.toLowerCase() ?? "";

export function isInstaller(d: Pick<DownloadInfo, "url" | "finalUrl" | "filename" | "mime">) {
  if (INSTALLER_MIME.has(d.mime.toLowerCase())) return true;
  const base = d.filename.split(/[/\\]/).pop() ?? "";
  return [base, pathOf(d.finalUrl), pathOf(d.url)].some((n) => n !== "" && INSTALLER_EXT.test(n));
}

export function judgeDownload(d: DownloadInfo, ctx: DownloadContext): DownloadVerdict {
  const allow = { pause: false } as const;
  if (ctx.mode === "allow") return allow;
  const site = siteOf(d.referrer);
  // No page started it (typed URL, the downloads page, a bookmark): the user's own choice.
  if (!site) return allow;
  // blob: and data: files are made by the page itself, so they come from the page's site.
  const urlSite = siteOf(d.url) ?? site;
  const fileSite = siteOf(d.finalUrl || d.url) ?? urlSite;
  if (fileSite === site) return allow;
  // A visible link the user clicked to the file's site, or the site's own download link
  // that redirects to its CDN (github.com → objects.githubusercontent.com).
  const clicked = new Set(ctx.clickedLinkSites);
  if (clicked.has(fileSite) || (urlSite === site && clicked.has(site))) return allow;

  const installer = isInstaller(d);
  if (!installer && ctx.mode !== "strict") return allow;
  // A site's own link that hands off to its CDN, with no click record: the page asked its
  // own server for a file. Pausing that would hit every vendor download page.
  if (urlSite === site && ctx.mode !== "strict") return allow;
  const base = d.filename.split(/[/\\]/).pop() || pathOf(d.finalUrl || d.url);
  return {
    pause: true,
    reason: installer ? "installer" : "no-click",
    site,
    fileSite,
    fileType: extOf(base),
  };
}
