import type { CascadeResult } from "@warden/shared/cascade";
import type { NavigationContext, SourceId, Stage } from "@warden/shared/types";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createNavigationHandler } from "../lib/handler.ts";
import { buildWarningUrl } from "../lib/interstitial.ts";
import { createOverrideStore } from "../lib/overrides.ts";
import { clearTabVerdict, setTabVerdict } from "../lib/tab-state.ts";

// Stage 0 and Stage 1 are wired in during Phase 2.
const stages: Stage[] = [];

function logResult(ctx: NavigationContext, result: CascadeResult) {
  console.debug("[Warden] cascade", ctx.url, result.decision, {
    total_ms: result.total_ms,
    timed_out: result.timed_out,
    stages: result.results.map((r) => ({
      stage: r.source,
      decision: r.decision,
      latency_ms: r.latency_ms,
      error: r.error,
    })),
  });
}

async function showInterstitial(ctx: NavigationContext, sources: SourceId[]) {
  const page = browser.runtime.getURL("/warning.html");
  await browser.tabs.update(ctx.tabId, {
    url: buildWarningUrl(page, { url: ctx.url, sources }),
  });
}

export default defineBackground({
  type: "module",
  main() {
    const session = browser.storage.session;
    const overrides = createOverrideStore(session);
    const handle = createNavigationHandler({
      stages: () => stages,
      onBlock: showInterstitial,
      isBypassed: overrides.isBypassed,
      onResult: logResult,
      onVerdict: (ctx, verdict) => setTabVerdict(session, ctx.tabId, verdict),
    });
    browser.tabs.onRemoved.addListener((tabId) => {
      void clearTabVerdict(session, tabId);
    });
    const listener = (details: Parameters<typeof handle>[0]) => {
      handle(details).catch((err) => console.error("[Warden] navigation handler failed", err));
    };
    browser.webNavigation.onBeforeNavigate.addListener(listener);
    browser.webNavigation.onCommitted.addListener(listener);
    browser.webNavigation.onHistoryStateUpdated.addListener(listener);
  },
});
