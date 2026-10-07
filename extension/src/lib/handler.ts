import { type CascadeResult, runCascade } from "@warden/shared/cascade";
import type { NavigationContext, SourceId, Stage } from "@warden/shared/types";
import { shouldEvaluate } from "./navigation.ts";
import type { TabVerdict } from "./tab-state.ts";

/** Total time the cascade may spend on one hop. Covers the 1.5 s Safe Browsing timeout. */
export const CASCADE_BUDGET_MS = 2000;

/** The same allowed URL in the same tab is evaluated once within this window. */
const DEDUPE_WINDOW_MS = 3000;

export interface TopFrameNavigation {
  tabId: number;
  frameId: number;
  url: string;
  timeStamp: number;
  /** Earlier hops of the same navigation, oldest first (see redirects.ts). */
  redirectChain?: string[];
}

export interface HandlerDeps {
  stages: () => readonly Stage[];
  /**
   * Resolves once stage data (the stored allowlist) is loaded. A worker woken by a
   * navigation must not evaluate it with an empty allowlist.
   */
  ready?: () => Promise<void>;
  /**
   * False while the user has phishing protection off. Async: a worker woken by a
   * navigation must read the stored setting before deciding.
   */
  enabled?: () => Promise<boolean>;
  /** Called only for blocks the user hasn't already clicked through. */
  onBlock: (ctx: NavigationContext, sources: SourceId[]) => void | Promise<void>;
  isBypassed: (url: string, sources: readonly SourceId[]) => Promise<boolean>;
  onResult?: (ctx: NavigationContext, result: CascadeResult) => void;
  /** Final outcome for the hop, after bypasses are applied. */
  onVerdict?: (ctx: NavigationContext, verdict: TabVerdict) => void | Promise<void>;
  now?: () => number;
}

/** Sources behind the stages that blocked, for the interstitial and bypass checks. */
export function blockSources(result: CascadeResult): SourceId[] {
  const sources = result.results
    .filter((r) => r.decision === "block")
    .flatMap((r) => r.signals.map((s) => s.source));
  return [...new Set(sources)];
}

/**
 * Builds the listener shared by onBeforeNavigate, onCommitted, and onHistoryStateUpdated.
 * onCommitted matters: after a server redirect, it is the only event carrying the final URL.
 */
export function createNavigationHandler(deps: HandlerDeps) {
  const now = deps.now ?? Date.now;
  const recent = new Map<string, number>();

  return async (details: TopFrameNavigation): Promise<CascadeResult | null> => {
    if (details.frameId !== 0 || !shouldEvaluate(details.url)) return null;
    if (deps.enabled && !(await deps.enabled())) return null;

    const key = `${details.tabId}|${details.url}`;
    const t = now();
    const last = recent.get(key);
    if (last !== undefined && t - last < DEDUPE_WINDOW_MS) return null;
    recent.set(key, t);
    for (const [k, seen] of recent) {
      if (t - seen >= DEDUPE_WINDOW_MS) recent.delete(k);
    }

    const ctx: NavigationContext = {
      url: details.url,
      tabId: details.tabId,
      redirectChain: details.redirectChain ?? [],
      startedAt: details.timeStamp,
    };
    await deps.ready?.().catch(() => {});
    const result = await runCascade(deps.stages(), ctx, { budgetMs: CASCADE_BUDGET_MS });
    deps.onResult?.(ctx, result);

    const sources = blockSources(result);
    let bypassed = false;
    if (result.decision === "block") {
      // Never dedupe a block: a repeat visit to a blocked URL must be blocked again.
      recent.delete(key);
      bypassed = await deps.isBypassed(details.url, sources);
    }
    // Show the interstitial first: a failure recording popup state must never suppress a block.
    if (result.decision === "block" && !bypassed) await deps.onBlock(ctx, sources);
    await deps.onVerdict?.(ctx, {
      url: details.url,
      decision: result.decision,
      sources,
      bypassed,
      at: t,
    });
    return result;
  };
}
