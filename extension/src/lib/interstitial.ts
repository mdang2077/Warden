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
  allowlist: "Allowlist",
  user_override: "Your settings",
};

/** Sources that can appear on a block. */
const BLOCK_SOURCES = new Set<SourceId>([
  "safe_browsing",
  "openphish",
  "phishing_database",
  "phishstats",
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
