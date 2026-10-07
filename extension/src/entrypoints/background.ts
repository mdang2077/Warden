import { createAllowlistStage } from "@warden/shared/allowlist";
import type { CascadeResult } from "@warden/shared/cascade";
import { runCascade } from "@warden/shared/cascade";
import { bundledPopupNetworks, isPopupNetworkUrl } from "@warden/shared/popup-networks";
import { bundledSharedHosts, bundledSharedHostsFile } from "@warden/shared/shared-hosts";
import { createStage1, type LocalLists } from "@warden/shared/stage1";
import type { NavigationContext, SourceId, Stage } from "@warden/shared/types";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  addSessionBypass,
  type DnrApi,
  type DnrSessionApi,
  PHISHING_RULE_IDS,
  replaceRuleRange,
} from "../lib/dnr.ts";
import { createDnrHealer } from "../lib/dnr-heal.ts";
import { CASCADE_BUDGET_MS, createNavigationHandler } from "../lib/handler.ts";
import { createHijackAction } from "../lib/hijack-action.ts";
import { compileHijackRules, installHijackRules } from "../lib/hijack-rules.ts";
import { buildWarningUrl } from "../lib/interstitial.ts";
import { openListStore } from "../lib/list-store.ts";
import { createOverrideStore } from "../lib/overrides.ts";
import {
  DEFAULT_PREFS,
  normalizePrefs,
  type PopupPrefs,
  PREFS_KEY,
  readPrefs,
} from "../lib/popup-prefs.ts";
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
let local: LocalData = {
  allowlist: null,
  shared: bundledSharedHosts,
  popupNetworks: bundledPopupNetworks,
};
const localReady = refreshLocalData();

async function refreshLocalData() {
  local = await loadLocalData(browser.storage.local, bundledSharedHostsFile);
}

/** Toolbar-popup settings; kept current by the storage.onChanged listener in main(). */
let prefs: PopupPrefs = DEFAULT_PREFS;
const prefsReady = readPrefs(browser.storage.local).then((p) => {
  prefs = p;
});
const dynamicDnr = browser.declarativeNetRequest as unknown as DnrApi;

/** Rebuilds the hijack DNR range from the current list and prefs. */
async function refreshHijackRules() {
  await Promise.all([localReady, prefsReady]);
  await installHijackRules(dynamicDnr, compileHijackRules(local.popupNetworks, prefs));
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
    await prefsReady;
    const report = await syncFeeds({
      baseUrl: FEED_SERVICE_URL,
      fetch: (input, init) => fetch(input, init),
      lists,
      storage: browser.storage.local,
      dnr: dynamicDnr,
      bundledShared: bundledSharedHostsFile,
      phishingEnabled: () => prefs.phishing,
    });
    await refreshLocalData();
    await refreshHijackRules();
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
    void refreshHijackRules().catch((err) => console.error("[Warden] hijack rules failed", err));
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
    const hijack = createHijackAction({
      area: session,
      tabs: {
        remove: (tabId) => browser.tabs.remove(tabId),
        goBack: (tabId) => browser.tabs.goBack(tabId),
      },
      badge: {
        setBadgeText: (d) => browser.action.setBadgeText(d),
        setBadgeBackgroundColor: (d) => browser.action.setBadgeBackgroundColor(d),
      },
    });
    const logHijackError = (err: unknown) => console.error("[Warden] hijack guard failed", err);

    browser.storage.onChanged.addListener((changes, areaName) => {
      const change = changes[PREFS_KEY];
      if (areaName !== "local" || !change) return;
      const before = prefs;
      prefs = normalizePrefs(change.newValue);
      void refreshHijackRules().catch(logHijackError);
      if (before.phishing === prefs.phishing) return;
      if (prefs.phishing) void runSync();
      else void replaceRuleRange(dynamicDnr, PHISHING_RULE_IDS, []).catch(logHijackError);
    });

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
      void hijack.forgetTab(tabId);
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
      if (!prefs.phishing) return;
      void recordShadow(message, {
        tabId: sender.tab?.id,
        frameId: sender.frameId,
        url: sender.url,
      }).catch((err) => console.error("[Warden] shadow log failed", err));
    });
    const run = (details: Parameters<typeof handle>[0]) => {
      if (!prefs.phishing) return;
      handle(details).catch((err) => console.error("[Warden] navigation handler failed", err));
    };

    // Every top-frame hop is evaluated, and blocks carry the chain that led there.
    const redirects = createRedirectTracker();
    const mainFrame = { urls: ["<all_urls>"], types: ["main_frame" as const] };
    // Last main-frame request per tab: a page started it (initiator) or the browser did.
    const mainFrameRequests = new Map<number, { url: string; initiator: string | undefined }>();
    browser.webRequest.onBeforeRequest.addListener((d) => {
      if (d.tabId >= 0) {
        redirects.startRequest(d.tabId, d.requestId, d.url);
        mainFrameRequests.set(d.tabId, { url: d.url, initiator: d.initiator });
      }
      return undefined;
    }, mainFrame);
    const browserStarted = (tabId: number, url: string) => {
      const request = mainFrameRequests.get(tabId);
      return request?.url === url && request.initiator === undefined;
    };
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
    browser.tabs.onRemoved.addListener((tabId) => {
      redirects.forgetTab(tabId);
      mainFrameRequests.delete(tabId);
    });

    // Hijack guard, Standard layer: DNR blocks pop networks; this closes or goes back.
    browser.webNavigation.onCreatedNavigationTarget.addListener((d) => {
      void hijack.recordOpener(d.tabId, d.sourceTabId).catch(logHijackError);
    });
    browser.webNavigation.onCommitted.addListener((d) => {
      // A blocked pop-network load is not the page the counts belong to.
      if (d.frameId !== 0 || isPopupNetworkUrl(local.popupNetworks, d.url)) return;
      void hijack.onCommitted(d.tabId, d.url).catch(logHijackError);
    });

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
      // A navigation the browser started (typed, bookmark) to a listed network is the user's
      // choice; DNR blocked it anyway (thirdParty matches no-initiator loads), so it heals.
      isHijack: (url, tabId) =>
        prefs.hijack && isPopupNetworkUrl(local.popupNetworks, url) && !browserStarted(tabId, url),
      onHijack: async (d) => {
        await hijack.handle({ tabId: d.tabId, url: d.url, layer: "standard" });
      },
    });
    browser.webNavigation.onErrorOccurred.addListener((d) => {
      heal(d).catch((err) => console.error("[Warden] DNR fallback failed", err));
    });
  },
});
