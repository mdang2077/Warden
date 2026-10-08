/**
 * Strict mode's decision (spec §6): is a new tab or a cross-site navigation from a tab on
 * strict site S a hijack? Pure, so every case is unit-tested. The inputs are the event
 * and the user's recent clicks in that tab (any frame), reported by the hijack-clicks
 * content script with the visible link (if any) under the pointer.
 *
 * When unsure it allows: a lost click record must never close a tab the user asked for.
 */
import { isAuthPopupHost } from "@warden/shared/auth-popups";
import { registrableDomain } from "@warden/shared/psl";

export const CLICK_WINDOW_MS = 1_000;
/** How long the worker waits for a click message after a new tab appears. */
export const CLICK_WAIT_MS = 250;
export const CLICK_RETENTION_MS = 5_000;

export interface ClickRecord {
  at: number;
  input: "pointer" | "key";
  /** Resolved href of the visible link under the click, or null. */
  linkHref: string | null;
}

export type StrictEvent =
  | { kind: "new-tab"; url: string; at: number }
  | {
      kind: "navigation";
      url: string;
      at: number;
      transitionType: string;
      transitionQualifiers: readonly string[];
      initiator?: string;
      /** URLs of the request's server-redirect hops, first to last. */
      chain?: readonly string[];
    };

const withoutFragment = (url: string) => url.split("#")[0] as string;

const BROWSER_STARTED_TYPES = new Set([
  "typed",
  "auto_bookmark",
  "generated",
  "keyword",
  "keyword_generated",
  "reload",
  "start_page",
]);
const BROWSER_STARTED_QUALIFIERS = ["forward_back", "from_address_bar"];

function webHost(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}

const siteOf = (host: string) => registrableDomain(host) ?? host;

export function isHijack(
  site: string,
  event: StrictEvent,
  clicks: readonly ClickRecord[],
): boolean {
  const host = webHost(event.url);
  if (host === null) return false;
  const destination = siteOf(host);
  if (destination === site) return false;

  const recent = clicks.filter((c) => Math.abs(event.at - c.at) <= CLICK_WINDOW_MS);
  // A visible link to the destination's site, or to a hop that server-redirected there
  // (download links, outbound /out?u= links, shorteners).
  const hops = event.kind === "navigation" ? (event.chain ?? []).map(withoutFragment) : [];
  const linkedThere = recent.some((c) => {
    const linkHost = c.linkHref ? webHost(c.linkHref) : null;
    if (linkHost === null || !c.linkHref) return false;
    return siteOf(linkHost) === destination || hops.includes(withoutFragment(c.linkHref));
  });
  if (linkedThere) return false;
  // Sign-in and payment pages, as a popup or a same-tab redirect from a button.
  if (isAuthPopupHost(host)) return false;

  if (event.kind === "new-tab") {
    // No click at all: Chrome's popup blocker already stops gesture-less window.open.
    return recent.length > 0;
  }

  if (
    BROWSER_STARTED_TYPES.has(event.transitionType) ||
    BROWSER_STARTED_QUALIFIERS.some((q) => event.transitionQualifiers.includes(q))
  ) {
    return false;
  }
  const initiatorHost = event.initiator ? webHost(event.initiator) : null;
  if (initiatorHost !== null) {
    const initiator = siteOf(initiatorHost);
    if (initiator !== site && initiator !== destination) return true;
  }
  if (event.transitionQualifiers.includes("client_redirect")) return true;
  if (event.transitionType === "form_submit") return recent.length === 0;
  return recent.length > 0;
}

/** Recent clicks per tab, in worker memory only; never stored. */
export function createClickLog(now: () => number = Date.now) {
  const byTab = new Map<number, ClickRecord[]>();
  const waiters = new Set<{ tabId: number; since: number; done: () => void }>();
  const fresh = (list: readonly ClickRecord[]) =>
    list.filter((c) => now() - c.at <= CLICK_RETENTION_MS);

  return {
    add(tabId: number, click: ClickRecord): void {
      byTab.set(tabId, fresh([...(byTab.get(tabId) ?? []), click]));
      for (const w of [...waiters]) if (w.tabId === tabId && click.at >= w.since) w.done();
    },
    recent(tabId: number): ClickRecord[] {
      const list = fresh(byTab.get(tabId) ?? []);
      byTab.set(tabId, list);
      return list;
    },
    waitFor(tabId: number, since: number, timeoutMs: number): Promise<void> {
      if ((byTab.get(tabId) ?? []).some((c) => c.at >= since)) return Promise.resolve();
      return new Promise((resolve) => {
        const waiter = {
          tabId,
          since,
          done: () => {
            clearTimeout(timer);
            waiters.delete(waiter);
            resolve();
          },
        };
        const timer = setTimeout(waiter.done, timeoutMs);
        waiters.add(waiter);
      });
    },
    /** Sites of visible links clicked in any tab within the last `windowMs` (H9 downloads). */
    recentLinkSites(windowMs: number): string[] {
      const sites = new Set<string>();
      for (const list of byTab.values()) {
        for (const c of list) {
          if (!c.linkHref || now() - c.at > windowMs) continue;
          try {
            const host = new URL(c.linkHref).hostname;
            sites.add(registrableDomain(host) ?? host);
          } catch {
            // not a URL
          }
        }
      }
      return [...sites];
    },
    forget(tabId: number): void {
      byTab.delete(tabId);
    },
  };
}

export type ClickLog = ReturnType<typeof createClickLog>;
