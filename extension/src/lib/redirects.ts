/**
 * Tracks redirect chains per tab so every top-frame hop can be evaluated and the
 * interstitial can show the link the user actually followed.
 *
 * - Server redirects: webRequest gives one requestId per navigation and an
 *   onBeforeRedirect per hop (webNavigation only sees the first and final URLs).
 * - Client redirects (JS, meta refresh): onCommitted flags them with `client_redirect`;
 *   the chain then continues from the page that redirected.
 *
 * State lives in the service worker's memory. If the worker restarts mid-chain, the
 * chain is simply shorter; it never affects the block decision itself.
 */

/** Chains longer than this are truncated to their first and most recent hops. */
const MAX_CHAIN = 20;

interface Navigation {
  requestId: string;
  /** Every URL so far, the latest last. */
  hops: string[];
}

interface Committed {
  url: string;
  chain: string[];
}

export function createRedirectTracker() {
  const current = new Map<number, Navigation>();
  const committed = new Map<number, Committed>();

  function cap(chain: string[]): string[] {
    return chain.length <= MAX_CHAIN
      ? chain
      : [chain[0] as string, ...chain.slice(-(MAX_CHAIN - 1))];
  }

  return {
    /** webRequest.onBeforeRequest for a main_frame request. */
    startRequest(tabId: number, requestId: string, url: string): void {
      if (current.get(tabId)?.requestId === requestId) return;
      current.set(tabId, { requestId, hops: [url] });
    },

    /** webRequest.onBeforeRedirect. Returns the hops before `toUrl`, oldest first. */
    redirect(tabId: number, requestId: string, fromUrl: string, toUrl: string): string[] {
      let nav = current.get(tabId);
      if (nav?.requestId !== requestId) {
        nav = { requestId, hops: [fromUrl] };
        current.set(tabId, nav);
      }
      const before = [...nav.hops];
      nav.hops = cap([...nav.hops, toUrl]);
      return before;
    },

    /**
     * Earlier hops for a webNavigation event on `url`. `clientRedirect` comes from
     * onCommitted's transitionQualifiers.
     */
    chainFor(tabId: number, url: string, clientRedirect = false): string[] {
      const nav = current.get(tabId);
      const serverHops = nav && nav.hops[nav.hops.length - 1] === url ? nav.hops.slice(0, -1) : [];
      const prev = committed.get(tabId);
      const clientHops =
        clientRedirect && prev && prev.url !== url ? [...prev.chain, prev.url] : [];
      return cap([...clientHops, ...serverHops]);
    },

    /** webNavigation.onCommitted: remember the page and how the user got there. */
    commit(tabId: number, url: string, chain: string[]): void {
      committed.set(tabId, { url, chain: cap(chain) });
      current.delete(tabId);
    },

    forgetTab(tabId: number): void {
      current.delete(tabId);
      committed.delete(tabId);
    },
  };
}

export type RedirectTracker = ReturnType<typeof createRedirectTracker>;
