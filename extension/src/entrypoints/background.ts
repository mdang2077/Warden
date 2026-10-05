import { createAllowlistStage } from "@warden/shared/allowlist";
import type { CascadeResult } from "@warden/shared/cascade";
import { runCascade } from "@warden/shared/cascade";
import { bundledSharedHosts, bundledSharedHostsFile } from "@warden/shared/shared-hosts";
import { createStage1, type LocalLists } from "@warden/shared/stage1";
import type { NavigationContext, SourceId, Stage } from "@warden/shared/types";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { addSessionBypass, type DnrApi, type DnrSessionApi } from "../lib/dnr.ts";
import { createDnrHealer } from "../lib/dnr-heal.ts";
import { CASCADE_BUDGET_MS, createNavigationHandler } from "../lib/handler.ts";
import { buildWarningUrl } from "../lib/interstitial.ts";
import { openListStore } from "../lib/list-store.ts";
import { createOverrideStore } from "../lib/overrides.ts";
import { createRedirectTracker } from "../lib/redirects.ts";
import { createSafeBrowsingClient } from "../lib/safe-browsing.ts";
import { createShadowRecorder } from "../lib/shadow-log.ts";
import { type LocalData, loadLocalData, SYNC_PERIOD_MINUTES, syncFeeds } from "../lib/sync.ts";
import { clearTabVerdict, getTabVerdict, setTabVerdict } from "../lib/tab-state.ts";
import { e2eTestStage } from "../lib/test-stage.ts";

/**
 * Feed service base URL, set at build time (`WXT_FEED_SERVICE_URL=https://… wxt build`).
 * Without it there is no sync and no Safe Browsing: Stage 0 and Stage 1 find nothing.
 */
const FEED_SERVICE_URL: string | undefined = import.meta.env.WXT_FEED_SERVICE_URL || undefined;
const SYNC_ALARM = "feed-sync";

// A failed open leaves lookups failing open (Stage 1 treats a throw as "no hit").
const listStore = openListStore().catch((err: unknown) => {
  console.error("[Warden] list store unavailable; local feeds disabled", err);
  return null;
});
/** Allowlist and shared-host list from the last good sync, swapped in after each sync. */
let local: LocalData = { allowlist: null, shared: bundledSharedHosts };
const localReady = refreshLocalData();

async function refreshLocalData() {
  local = await loadLocalData(browser.storage.local, bundledSharedHostsFile);
}

const lists: LocalLists = {
  match: async (url, now) => {
    const store = await listStore;
    if (!store) throw new Error("list store unavailable");
    return store.match(url, local.shared, now);
  },
};
const stages: Stage[] = [
  createAllowlistStage({
    allowlist: () => local.allowlist,
    userDomains: () => new Set(),
    shared: () => local.shared,
  }),
  createStage1({
    lists,
    safeBrowsing: FEED_SERVICE_URL
      ? createSafeBrowsingClient({ endpoint: `${FEED_SERVICE_URL}/sb/hashes-search` })
      : null,
  }),
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

let syncing: Promise<void> | null = null;

/** One sync at a time; failures keep the last good data (see sync.ts). */
function runSync(): Promise<void> {
  if (!FEED_SERVICE_URL) return Promise.resolve();
  syncing ??= (async () => {
    const lists = await listStore;
    if (!lists) return;
    const report = await syncFeeds({
      baseUrl: FEED_SERVICE_URL,
      fetch: (input, init) => fetch(input, init),
      lists,
      storage: browser.storage.local,
      dnr: browser.declarativeNetRequest as unknown as DnrApi,
      bundledShared: bundledSharedHostsFile,
    });
    await refreshLocalData();
    if (report.error) console.warn("[Warden] feed sync failed, keeping last good data", report);
    else console.debug("[Warden] feed sync", report);
  })().finally(() => {
    syncing = null;
  });
  return syncing;
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
    // Sync on install/update and browser start, then every SYNC_PERIOD_MINUTES.
    browser.runtime.onInstalled.addListener(() => void runSync());
    browser.runtime.onStartup.addListener(() => void runSync());
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SYNC_ALARM) void runSync();
    });
    void browser.alarms.get(SYNC_ALARM).then((existing) => {
      if (!existing) {
        void browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
      }
    });

    const session = browser.storage.session;
    const overrides = createOverrideStore(session);
    const handle = createNavigationHandler({
      stages: () => stages,
      ready: () => localReady,
      onBlock: showInterstitial,
      isBypassed: overrides.isBypassed,
      onResult: logResult,
      onVerdict: (ctx, verdict) => setTabVerdict(session, ctx.tabId, verdict),
    });
    browser.tabs.onRemoved.addListener((tabId) => {
      void clearTabVerdict(session, tabId);
    });

    // Stage 2 shadow mode: the content script reports secret-entry surfaces; nothing is shown.
    const recordShadow = createShadowRecorder({
      area: browser.storage.local,
      allowlisted: (host) => local.allowlist?.allows(host) ?? false,
      stage1For: async (tabId, url) => {
        const verdict = await getTabVerdict(session, tabId);
        const strip = (u: string) => u.split("#")[0];
        return verdict && strip(verdict.url) === strip(url) ? verdict.decision : null;
      },
    });
    browser.runtime.onMessage.addListener((message, sender) => {
      void recordShadow(message, {
        tabId: sender.tab?.id,
        frameId: sender.frameId,
        url: sender.url,
      }).catch((err) => console.error("[Warden] shadow log failed", err));
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

    // No chain yet: this navigation hasn't sent a request, so any hops the tracker holds
    // belong to an earlier navigation in the tab.
    browser.webNavigation.onBeforeNavigate.addListener((d) => run({ ...d, redirectChain: [] }));
    browser.webNavigation.onCommitted.addListener((d) => {
      if (d.frameId !== 0) return;
      const clientRedirect = d.transitionQualifiers.includes("client_redirect");
      const redirectChain = redirects.chainFor(d.tabId, d.url, clientRedirect);
      redirects.commit(d.tabId, d.url, redirectChain);
      run({ ...d, redirectChain });
    });
    browser.webNavigation.onHistoryStateUpdated.addListener((d) => run(d));
    browser.tabs.onRemoved.addListener((tabId) => redirects.forgetTab(tabId));

    // A DNR rule the worker disagrees with (stale since the last sync) gets one retry.
    const dnr = browser.declarativeNetRequest as unknown as DnrSessionApi;
    const heal = createDnrHealer({
      evaluate: async (url, tabId) => {
        await localReady;
        const ctx = { url, tabId, redirectChain: [], startedAt: Date.now() };
        return (await runCascade(stages, ctx, { budgetMs: CASCADE_BUDGET_MS })).decision;
      },
      allow: (url) => addSessionBypass(dnr, url),
      reload: async (tabId, url) => {
        await browser.tabs.update(tabId, { url });
      },
    });
    browser.webNavigation.onErrorOccurred.addListener((d) => {
      heal(d).catch((err) => console.error("[Warden] DNR fallback failed", err));
    });
  },
});
