/**
 * Recognizes crawls that never reached the phishing page: something in between (the ISP,
 * a CDN, the host) blocked or replaced it. Those crawls say nothing about the page and
 * must not be counted as "loaded phish" in Stage 2 measurements.
 *
 * Seen in practice: Spectrum's Security Shield (CUJO) redirects plain HTTP to its warning
 * page and resets TLS handshakes by server name; Cloudflare replaces reported sites with a
 * "Suspected Phishing" page; hosts replace suspended accounts with a notice.
 */
import type { CrawlRecord } from "./crawler.ts";

export type Interception =
  /** A network filter between the crawler and the site (ISP, router, corporate proxy). */
  | "network-filter"
  /** The site's CDN or host replaced the page with a warning or suspension notice. */
  | "provider-takedown";

const FILTER_HOSTS = [/\.cujo\.io$/i];
const FILTER_TEXT = [/^Suspicious Site Blocked\b/i];
const TAKEDOWN_TITLES = [
  /^Suspected Phishing \| Cloudflare$/i,
  /^Phishing Warning/i,
  /\baccount (has been )?suspended\b/i,
  /^Suspended Domain/i,
  /^This site has been suspended/i,
];

export function classifyInterception(
  r: Pick<CrawlRecord, "ok" | "final_url" | "error" | "snapshot">,
): Interception | null {
  if (r.final_url) {
    try {
      const host = new URL(r.final_url).hostname;
      if (FILTER_HOSTS.some((re) => re.test(host))) return "network-filter";
    } catch {
      // Unparseable final URL: fall through to content checks.
    }
  }
  const text = r.snapshot?.text ?? "";
  const title = r.snapshot?.title ?? "";
  if (FILTER_TEXT.some((re) => re.test(text))) return "network-filter";
  if (TAKEDOWN_TITLES.some((re) => re.test(title))) return "provider-takedown";
  return null;
}

/**
 * True for a failed crawl whose TLS handshake was cut off: what a filter that blocks by
 * server name (SNI) produces. Also matches some genuinely broken servers, so it is reported
 * separately rather than folded into "network-filter".
 */
export function isTlsReset(r: Pick<CrawlRecord, "ok" | "error">): boolean {
  return (
    !r.ok && /ERR_SSL_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/.test(r.error ?? "")
  );
}
