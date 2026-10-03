import { createAllowlistStage } from "@warden/shared/allowlist";
import type { CascadeResult } from "@warden/shared/cascade";
import { bundledSharedHosts } from "@warden/shared/shared-hosts";
import { createStage1, type LocalLists } from "@warden/shared/stage1";
import type { NavigationContext, SourceId, Stage } from "@warden/shared/types";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createNavigationHandler } from "../lib/handler.ts";
import { buildWarningUrl } from "../lib/interstitial.ts";
import { openListStore } from "../lib/list-store.ts";
import { createOverrideStore } from "../lib/overrides.ts";
import { createRedirectTracker } from "../lib/redirects.ts";
import { clearTabVerdict, setTabVerdict } from "../lib/tab-state.ts";
import { e2eTestStage } from "../lib/test-stage.ts";

// The allowlist, list contents, and Safe Browsing proxy endpoint arrive with feed sync (T3.8).
// Until then Stage 0 reports nothing, Stage 1 finds nothing, and Safe Browsing is skipped.
const listStore = openListStore();
const lists: LocalLists = {
  match: async (url, now) => (await listStore).match(url, bundledSharedHosts, now),
};
const stages: Stage[] = [
  createAllowlistStage({
    allowlist: () => null,
    userDomains: () => new Set(),
    shared: () => bundledSharedHosts,
  }),
  createStage1({ lists, safeBrowsing: null }),
  // The e2e build adds a test-only stage that blocks one reserved host.
  ...(import.meta.env.MODE === "e2e" ? [e2eTestStage] : []),
];

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
  const origin = ctx.redirectChain[0];
  const warning = buildWarningUrl(page, { url: ctx.url, sources, ...(origin ? { origin } : {}) });
  await browser.tabs.update(ctx.tabId, { url: warning });
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
    const run = (details: Parameters<typeof handle>[0]) => {
      handle(details).catch((err) => console.error("[Warden] navigation handler failed", err));
    };

    // Every top-frame hop is evaluated, and blocks carry the chain that led there.
    const redirects = createRedirectTracker();
    const mainFrame = { urls: ["<all_urls>"], types: ["main_frame" as const] };
    browser.webRequest.onBeforeRequest.addListener((d) => {
      if (d.tabId >= 0) redirects.startRequest(d.tabId, d.requestId, d.url);
      return undefined;
    }, mainFrame);
    browser.webRequest.onBeforeRedirect.addListener((d) => {
      if (d.tabId < 0) return;
      const redirectChain = redirects.redirect(d.tabId, d.requestId, d.url, d.redirectUrl);
      run({
        tabId: d.tabId,
        frameId: 0,
        url: d.redirectUrl,
        timeStamp: d.timeStamp,
        redirectChain,
      });
    }, mainFrame);

    browser.webNavigation.onBeforeNavigate.addListener((d) => {
      run({ ...d, redirectChain: redirects.chainFor(d.tabId, d.url) });
    });
    browser.webNavigation.onCommitted.addListener((d) => {
      if (d.frameId !== 0) return;
      const clientRedirect = d.transitionQualifiers.includes("client_redirect");
      const redirectChain = redirects.chainFor(d.tabId, d.url, clientRedirect);
      redirects.commit(d.tabId, d.url, redirectChain);
      run({ ...d, redirectChain });
    });
    browser.webNavigation.onHistoryStateUpdated.addListener((d) => run(d));
    browser.tabs.onRemoved.addListener((tabId) => redirects.forgetTab(tabId));
  },
});
