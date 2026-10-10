/**
 * Encoding and decoding of the interstitial's query string. The page is web-accessible
 * (DNR redirects need that), so anyone can open it with arbitrary parameters: every
 * value is validated here and rendered as text only.
 */
import type { SourceId } from "@warden/shared/types";

export const SOURCE_LABELS: Readonly<Record<SourceId, string>> = {
  safe_browsing: "Google Safe Browsing",
  openphish: "OpenPhish",
  phishing_database: "Phishing.Database",
  phishstats: "PhishStats",
  cert_pl: "CERT Polska",
  allowlist: "Allowlist",
  user_override: "Your settings",
};

/** Sources that can appear on a block. */
const BLOCK_SOURCES = new Set<SourceId>([
  "safe_browsing",
  "openphish",
  "phishing_database",
  "phishstats",
  "cert_pl",
]);

export interface WarningParams {
  /** The blocked URL. Always http(s). */
  url: string;
  sources: SourceId[];
  /** The link the user followed, when the blocked page was reached by redirect. */
  origin?: string;
}

export function buildWarningUrl(pageUrl: string, params: WarningParams): string {
  const url = new URL(pageUrl);
  url.searchParams.set("u", params.url);
  url.searchParams.set("s", params.sources.join(","));
  if (params.origin && params.origin !== params.url) url.searchParams.set("o", params.origin);
  return url.href;
}

/** Returns null when the blocked URL is missing or isn't http(s). */
export function parseWarningParams(search: string): WarningParams | null {
  const params = new URLSearchParams(search);
  const url = parseHttpUrl(params.get("u"));
  if (!url) return null;

  const sources = (params.get("s") ?? "")
    .split(",")
    .filter((s): s is SourceId => BLOCK_SOURCES.has(s as SourceId));
  const origin = parseHttpUrl(params.get("o"));
  return {
    url: url.href,
    sources: [...new Set(sources)],
    ...(origin && origin.href !== url.href ? { origin: origin.href } : {}),
  };
}

function parseHttpUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const ISSUE_FORM = "https://github.com/mdang2077/Warden/issues/new";

/**
 * The public "wrong block" issue form, pre-filled. Only the page's origin and path go in:
 * a query or fragment can carry tokens, and the issue is public.
 */
export function reportIssueUrl(blockedUrl: string, sources: readonly SourceId[]): string {
  let page = "";
  try {
    const u = new URL(blockedUrl);
    if (u.protocol === "http:" || u.protocol === "https:") page = u.origin + u.pathname;
  } catch {
    // not a URL: leave the field empty
  }
  const url = new URL(ISSUE_FORM);
  url.searchParams.set("template", "false-positive.yml");
  url.searchParams.set("url", page);
  url.searchParams.set("sources", sources.map((s) => SOURCE_LABELS[s] ?? s).join(", "));
  return url.href;
}
