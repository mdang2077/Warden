import { createAllowlistStage } from "@warden/shared/allowlist";
import type { CascadeResult } from "@warden/shared/cascade";
import { runCascade } from "@warden/shared/cascade";
import {
  bundledPopupNetworks,
  isPopupNetworkUrl,
  type PopupNetworkList,
} from "@warden/shared/popup-networks";
import { bundledSharedHosts, bundledSharedHostsFile } from "@warden/shared/shared-hosts";
import { createStage1, type LocalLists } from "@warden/shared/stage1";
import type { NavigationContext, SourceId, Stage } from "@warden/shared/types";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { isStrictQuery, parseClickMessage } from "../lib/click-capture.ts";
import {
  addSessionBypass,
  addTabBypass,
  type DnrApi,
  type DnrSessionApi,
  PHISHING_RULE_IDS,
  replaceRuleRange,
} from "../lib/dnr.ts";
import { createDnrHealer } from "../lib/dnr-heal.ts";
import { CASCADE_BUDGET_MS, createNavigationHandler } from "../lib/handler.ts";
import { createHijackAction, getHijackRecord } from "../lib/hijack-action.ts";
import { CLICK_WAIT_MS, CLICK_WINDOW_MS, createClickLog, isHijack } from "../lib/hijack-detect.ts";
import { compileHijackRules, installHijackRules, withUserBlocks } from "../lib/hijack-rules.ts";
import { buildWarningUrl } from "../lib/interstitial.ts";
import { openListStore } from "../lib/list-store.ts";
import { createNotices, NOTICE_MESSAGE, NOTICE_POLL } from "../lib/notices.ts";
import { createOverrideStore } from "../lib/overrides.ts";
import {
  DEFAULT_PREFS,
  isStrict,
  normalizePrefs,
  type PopupPrefs,
  PREFS_KEY,
  readPrefs,
  siteKey,
} from "../lib/popup-prefs.ts";
import { createRedirectTracker } from "../lib/redirects.ts";
import { createSafeBrowsingClient } from "../lib/safe-browsing.ts";
import { createShadowRecorder } from "../lib/shadow-log.ts";
import { type LocalData, loadLocalData, SYNC_PERIOD_MINUTES, syncFeeds } from "../lib/sync.ts";
import { clearTabVerdict, getTabVerdict, setTabVerdict } from "../lib/tab-state.ts";
import { e2eTestStage } from "../lib/test-stage.ts";
import { readTrusted } from "../lib/trusted-sites.ts";

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

/** The synced pop-network list plus the user's blocked sites, rebuilt only when either changes. */
let merged: { list: PopupNetworkList; blocked: string[]; out: PopupNetworkList } | null = null;
function popupNetworks(): PopupNetworkList {
  if (merged?.list !== local.popupNetworks || merged.blocked !== prefs.blocked) {
    const out = withUserBlocks(local.popupNetworks, prefs);
    merged = { list: local.popupNetworks, blocked: prefs.blocked, out };
  }
  return merged.out;
}

/** Rebuilds the hijack DNR range from the current list and prefs. */
async function refreshHijackRules() {
  await Promise.all([localReady, prefsReady]);
  await installHijackRules(dynamicDnr, compileHijackRules(popupNetworks(), prefs));
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
    // Deliberately empty: a user-trusted site (trusted-sites.ts) must not reach Stage 0,
    // or Stage 1 would skip the phishing lists for it. Trust only covers Stage 2+.
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
    // "Warden closed a pop-up to …" on the page (notice.content.ts), when turned on.
    const notices = createNotices({
      send: async (tabId, text) =>
        (await browser.tabs
          .sendMessage(tabId, { type: NOTICE_MESSAGE, text }, { frameId: 0 })
          .catch(() => undefined)) === true,
      enabled: () => prefs.hijack && prefs.notices,
    });
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
      notify: (tabId, block) => notices.blocked(tabId, block),
    });
    const logHijackError = (err: unknown) => console.error("[Warden] hijack guard failed", err);
    // Hijack guard, strict mode: clicks reported by the hijack-clicks content script.
    const clicks = createClickLog();
    const strictSite = (url: string | undefined) => {
      const site = url ? siteKey(url) : null;
      return site !== null && isStrict(prefs, site) ? site : null;
    };

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
      enabled: async () => {
        await prefsReady;
        return prefs.phishing;
      },
      onBlock: showInterstitial,
      isBypassed: overrides.isBypassed,
      onResult: logResult,
      onVerdict: (ctx, verdict) => setTabVerdict(session, ctx.tabId, verdict),
    });
    browser.tabs.onRemoved.addListener((tabId) => {
      void clearTabVerdict(session, tabId);
      void hijack.forgetTab(tabId);
      clicks.forget(tabId);
      notices.forgetTab(tabId);
    });

    // Stage 2 shadow mode: the content script reports secret-entry surfaces; nothing is shown.
    const recordShadow = createShadowRecorder({
      area: browser.storage.local,
      allowlisted: (host) => local.allowlist?.allows(host) ?? false,
      sharedHosts: () => local.shared,
      trusted: async (host) => {
        const site = siteKey(`https://${host}/`);
        return site !== null && (await readTrusted(browser.storage.local)).has(site);
      },
      stage1For: async (tabId, url) => {
        const verdict = await getTabVerdict(session, tabId);
        const strip = (u: string) => u.split("#")[0];
        return verdict && strip(verdict.url) === strip(url) ? verdict.decision : null;
      },
    });
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if ((message as { type?: unknown } | null)?.type === NOTICE_POLL) {
        const text =
          sender.tab?.id !== undefined && sender.frameId === 0 ? notices.poll(sender.tab.id) : null;
        sendResponse(text ? { type: NOTICE_MESSAGE, text } : null);
        return;
      }
      if (isStrictQuery(message)) {
        void prefsReady.then(() => sendResponse(strictSite(sender.tab?.url) !== null));
        return true; // answered asynchronously
      }
      const click = parseClickMessage(message);
      if (click) {
        if (sender.tab?.id !== undefined) clicks.add(sender.tab.id, click);
        return;
      }
      void prefsReady
        .then(() => {
          if (!prefs.phishing) return;
          return recordShadow(message, {
            tabId: sender.tab?.id,
            frameId: sender.frameId,
            url: sender.url,
          });
        })
        .catch((err) => console.error("[Warden] shadow log failed", err));
    });
    const run = (details: Parameters<typeof handle>[0]) => {
      handle(details).catch((err) => console.error("[Warden] navigation handler failed", err));
    };

    // Every top-frame hop is evaluated, and blocks carry the chain that led there.
    const redirects = createRedirectTracker();
    const mainFrame = { urls: ["<all_urls>"], types: ["main_frame" as const] };
    // Last main-frame request per tab: who started it (a page's initiator, or none for the
    // browser), when, and its server-redirect hops. A redirect keeps the requestId.
    interface MainFrameRequest {
      requestId: string;
      url: string;
      initiator: string | undefined;
      startedAt: number;
      hops: string[];
    }
    const mainFrameRequests = new Map<number, MainFrameRequest>();
    browser.webRequest.onBeforeRequest.addListener((d) => {
      if (d.tabId >= 0) {
        redirects.startRequest(d.tabId, d.requestId, d.url);
        const prev = mainFrameRequests.get(d.tabId);
        // A redirect keeps the requestId; a restarted request for the last hop is the same
        // navigation too.
        const redirected = prev?.requestId === d.requestId;
        const restarted = !redirected && prev?.hops.at(-1) === d.url;
        const continues = prev && (redirected || restarted);
        mainFrameRequests.set(d.tabId, {
          requestId: d.requestId,
          url: d.url,
          initiator: continues ? prev.initiator : d.initiator,
          startedAt: continues ? prev.startedAt : d.timeStamp,
          hops: !continues ? [d.url] : redirected ? [...prev.hops, d.url] : prev.hops,
        });
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
      if (d.frameId !== 0) return;
      void (async () => {
        await Promise.all([localReady, prefsReady]);
        // A blocked pop-network load is not the page the counts belong to.
        if (isPopupNetworkUrl(popupNetworks(), d.url)) return;
        // Strict mode: a cross-site navigation away from a strict site may be a hijack.
        const before = await getHijackRecord(session, d.tabId);
        const site = before?.siteKey && isStrict(prefs, before.siteKey) ? before.siteKey : null;
        if (site && siteKey(d.url) !== site) {
          const request = mainFrameRequests.get(d.tabId);
          const initiator = request?.initiator;
          const event = {
            kind: "navigation" as const,
            url: d.url,
            // When the request started: a slow server must not push the click out of the window.
            at: request?.startedAt ?? d.timeStamp,
            ...(request ? { chain: request.hops } : {}),
            transitionType: d.transitionType,
            transitionQualifiers: d.transitionQualifiers,
            ...(initiator ? { initiator } : {}),
          };
          if (isHijack(site, event, clicks.recent(d.tabId))) {
            // Not recorded as the tab's new site: the go-back returns it to `site`.
            await hijack.handle({ tabId: d.tabId, url: d.url, layer: "strict" });
            return;
          }
        }
        await hijack.onCommitted(d.tabId, d.url);
        // A redirect notice waits for the page the tab went back to.
        await notices.committed(d.tabId);
      })().catch(logHijackError);
    });

    // Strict mode: a new tab opened from a strict site without a click on a link to it.
    browser.webNavigation.onBeforeNavigate.addListener((d) => {
      if (d.frameId !== 0) return;
      void (async () => {
        await Promise.all([localReady, prefsReady]);
        // Pop networks are the Standard layer's (DNR) job.
        if (isPopupNetworkUrl(popupNetworks(), d.url)) return;
        const opener = await hijack.openerOf(d.tabId);
        if (!opener) return;
        const source = await browser.tabs.get(opener.sourceTabId).catch(() => null);
        const site = strictSite(source?.url);
        if (!site) return;
        await clicks.waitFor(opener.sourceTabId, opener.at - CLICK_WINDOW_MS, CLICK_WAIT_MS);
        const event = { kind: "new-tab" as const, url: d.url, at: opener.at };
        if (isHijack(site, event, clicks.recent(opener.sourceTabId))) {
          const openedBy = opener.sourceTabId;
          await hijack.handle({ tabId: d.tabId, url: d.url, layer: "strict", openedBy });
        }
      })().catch(logHijackError);
    });

    // A DNR rule the worker disagrees with (stale since the last sync) gets one retry.
    const dnr = browser.declarativeNetRequest as unknown as DnrSessionApi;
    // A typed visit to a hijack-blocked site gets a one-tab, one-visit allow rule: a
    // session-wide one would also let other sites open it later (taskboard H10).
    const visitBypasses = new Map<number, { id: number; url: string }>();
    const dropVisitBypass = (tabId: number) => {
      const bypass = visitBypasses.get(tabId);
      if (!bypass) return;
      visitBypasses.delete(tabId);
      void dnr
        .updateSessionRules({ removeRuleIds: [bypass.id], addRules: [] })
        .catch(logHijackError);
    };
    browser.webNavigation.onCommitted.addListener((d) => {
      if (d.frameId === 0 && visitBypasses.get(d.tabId)?.url === d.url.split("#")[0]) {
        dropVisitBypass(d.tabId);
      }
    });
    browser.tabs.onRemoved.addListener((tabId) => dropVisitBypass(tabId));
    const heal = createDnrHealer({
      evaluate: async (url, tabId) => {
        await localReady;
        const ctx = { url, tabId, redirectChain: [], startedAt: Date.now() };
        return (await runCascade(stages, ctx, { budgetMs: CASCADE_BUDGET_MS })).decision;
      },
      allow: async (url, tabId) => {
        await Promise.all([localReady, prefsReady]);
        if (!(prefs.hijack && isPopupNetworkUrl(popupNetworks(), url))) {
          return addSessionBypass(dnr, url);
        }
        dropVisitBypass(tabId);
        const id = await addTabBypass(dnr, url, tabId);
        visitBypasses.set(tabId, { id, url: url.split("#")[0] as string });
        // If the visit never commits (the user goes elsewhere), don't leave the rule behind.
        setTimeout(() => {
          if (visitBypasses.get(tabId)?.id === id) dropVisitBypass(tabId);
        }, 30_000);
      },
      reload: async (tabId, url) => {
        await browser.tabs.update(tabId, { url });
      },
      // A navigation the browser started (typed, bookmark) to a listed network is the user's
      // choice; DNR blocked it anyway (thirdParty matches no-initiator loads), so it heals.
      // Waits for the synced list and prefs: after a worker wake, the event that woke it
      // arrives while `local` still holds only the bundled fallback list.
      isHijack: async (url, tabId) => {
        await Promise.all([localReady, prefsReady]);
        return (
          prefs.hijack && isPopupNetworkUrl(popupNetworks(), url) && !browserStarted(tabId, url)
        );
      },
      onHijack: async (d) => {
        await hijack.handle({ tabId: d.tabId, url: d.url, layer: "standard" });
      },
    });
    browser.webNavigation.onErrorOccurred.addListener((d) => {
      heal(d).catch((err) => console.error("[Warden] DNR fallback failed", err));
    });
  },
});
