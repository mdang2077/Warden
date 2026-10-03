/**
 * Fallback for a DNR block the service worker disagrees with. DNR rules run before the
 * worker and are only rebuilt on sync, so a rule can be stale (e.g. a domain the user
 * trusted since, or an allowlist update). When a top-frame navigation fails with
 * ERR_BLOCKED_BY_CLIENT and a fresh cascade doesn't block it, the URL gets a session allow
 * rule and is loaded again.
 *
 * Each URL is retried at most once per worker lifetime: ERR_BLOCKED_BY_CLIENT can also
 * come from another extension, and Warden must not loop fighting it.
 */
import type { Decision } from "@warden/shared/types";
import { shouldEvaluate } from "./navigation.ts";

export interface DnrHealDeps {
  /** Runs the cascade for a URL and returns its decision. */
  evaluate: (url: string, tabId: number) => Promise<Decision>;
  allow: (url: string) => Promise<void>;
  reload: (tabId: number, url: string) => Promise<void>;
}

export interface NavigationError {
  tabId: number;
  frameId: number;
  url: string;
  error: string;
}

export function createDnrHealer(deps: DnrHealDeps) {
  const retried = new Set<string>();

  return async (details: NavigationError): Promise<"healed" | "skipped"> => {
    if (details.frameId !== 0 || !details.error.includes("ERR_BLOCKED_BY_CLIENT")) return "skipped";
    if (!shouldEvaluate(details.url)) return "skipped";
    const key = details.url.split("#")[0] as string;
    if (retried.has(key)) return "skipped";
    retried.add(key);

    // The worker's own block path shows the interstitial for a real block.
    if ((await deps.evaluate(details.url, details.tabId)) === "block") return "skipped";
    await deps.allow(details.url);
    await deps.reload(details.tabId, details.url);
    return "healed";
  };
}
