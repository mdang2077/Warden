import { browser } from "wxt/browser";
import { addFpReport } from "../../lib/fp-reports.ts";
import { getHijackRecord } from "../../lib/hijack-action.ts";
import { describeExperiment, listExperiments } from "../../lib/hijack-experiments.ts";
import { parseWarningParams, reportIssueUrl, SOURCE_LABELS } from "../../lib/interstitial.ts";
import {
  readPrefs,
  type SiteMode,
  siteKey,
  siteMode,
  updatePrefs,
  withBlocked,
  withSiteMode,
} from "../../lib/popup-prefs.ts";
import { blockedView } from "../../lib/popup-view.ts";
import { readSbHealth, sbDegraded } from "../../lib/sb-health.ts";
import { listShadowEntries } from "../../lib/shadow-log.ts";
import { describeSignals, shadowExport, shadowSummary } from "../../lib/shadow-summary.ts";
import { getTabVerdict, type TabVerdict } from "../../lib/tab-state.ts";
import { listTrusted, setTrusted } from "../../lib/trusted-sites.ts";

const status = document.getElementById("status") as HTMLElement;
const detail = document.getElementById("detail") as HTMLElement;
const report = document.getElementById("report") as HTMLButtonElement;
const reportDone = document.getElementById("report-done") as HTMLElement;

function show(decision: string, title: string, text: string) {
  status.dataset.decision = decision;
  status.textContent = title;
  detail.textContent = text;
}

function withoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}

function sourceList(verdict: TabVerdict): string {
  return verdict.sources.map((s) => SOURCE_LABELS[s]).join(", ");
}

/**
 * "Trust this site" for the current site, and the list of every trusted site with a
 * Remove button each, so a site can be untrusted without visiting it.
 */
async function renderTrust(site: string | null) {
  const area = browser.storage.local;
  const toggle = document.getElementById("toggle-trust") as HTMLInputElement;
  const details = document.getElementById("trusted") as HTMLDetailsElement;
  const summary = document.getElementById("trusted-summary") as HTMLElement;
  const list = document.getElementById("trusted-list") as HTMLUListElement;

  const draw = async () => {
    const sites = await listTrusted(area);
    toggle.checked = site !== null && sites.includes(site);
    details.hidden = sites.length === 0;
    summary.textContent = `Trusted sites (${sites.length})`;
    list.replaceChildren(
      ...sites.map((s) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = s; // textContent only: site names come from web pages
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${s}`);
        remove.addEventListener("click", async () => {
          await setTrusted(area, s, false);
          await draw();
        });
        li.append(name, remove);
        return li;
      }),
    );
  };

  if (site !== null) {
    toggle.addEventListener("change", async () => {
      await setTrusted(area, site, toggle.checked);
      await draw();
    });
  }
  await draw();
}

/** The user's own blocked sites: the per-site checkbox and the list with Remove buttons. */
async function renderBlockedSites(site: string | null) {
  const area = browser.storage.local;
  const toggle = document.getElementById("toggle-block") as HTMLInputElement;
  const details = document.getElementById("blocked-sites") as HTMLDetailsElement;
  const summary = document.getElementById("blocked-sites-summary") as HTMLElement;
  const list = document.getElementById("blocked-sites-list") as HTMLUListElement;

  const draw = async () => {
    const { blocked } = await readPrefs(area);
    toggle.checked = site !== null && blocked.includes(site);
    details.hidden = blocked.length === 0;
    summary.textContent = `Blocked sites (${blocked.length})`;
    list.replaceChildren(
      ...blocked.map((s) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = s; // textContent only: site names come from web pages
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${s}`);
        remove.addEventListener("click", async () => {
          await updatePrefs(area, (p) => withBlocked(p, s, false));
          await draw();
        });
        li.append(name, remove);
        return li;
      }),
    );
  };

  if (site !== null) {
    toggle.addEventListener("change", async () => {
      await updatePrefs(area, (p) => withBlocked(p, site, toggle.checked));
      await draw();
    });
  }
  await draw();
}

/** Toggles, the per-site popup mode, and the "blocked on this page" list. */
async function renderControls(
  tab: { id?: number | undefined; url?: string | undefined } | undefined,
) {
  const area = browser.storage.local;
  const prefs = await readPrefs(area);
  const phishing = document.getElementById("toggle-phishing") as HTMLInputElement;
  const hijack = document.getElementById("toggle-hijack") as HTMLInputElement;
  const notices = document.getElementById("toggle-notices") as HTMLInputElement;
  phishing.checked = prefs.phishing;
  hijack.checked = prefs.hijack;
  notices.checked = prefs.notices;
  notices.disabled = !prefs.hijack;
  phishing.addEventListener("change", () => {
    void updatePrefs(area, (p) => ({ ...p, phishing: phishing.checked }));
  });
  hijack.addEventListener("change", () => {
    notices.disabled = !hijack.checked;
    void updatePrefs(area, (p) => ({ ...p, hijack: hijack.checked }));
  });
  notices.addEventListener("change", () => {
    void updatePrefs(area, (p) => ({ ...p, notices: notices.checked }));
  });

  const site = tab?.url ? siteKey(tab.url) : null;
  await renderTrust(site);
  await renderBlockedSites(site);
  if (site === null || tab?.id === undefined) return;
  (document.getElementById("site") as HTMLElement).hidden = false;
  (document.getElementById("site-name") as HTMLElement).textContent = site;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.checked = radio.value === siteMode(prefs, site);
    radio.addEventListener("change", () => {
      if (radio.checked) {
        void updatePrefs(area, (p) => withSiteMode(p, site, radio.value as SiteMode));
      }
    });
  }

  // textContent only: hostnames come from web pages.
  const view = blockedView(await getHijackRecord(browser.storage.session, tab.id), Date.now());
  if (!view) return;
  (document.getElementById("blocked") as HTMLElement).hidden = false;
  (document.getElementById("blocked-summary") as HTMLElement).textContent = view.summary;
  const list = document.getElementById("blocked-list") as HTMLUListElement;
  for (const row of view.rows) {
    const li = document.createElement("li");
    li.textContent = `${row.host} · ${row.kind} · ${row.age}`;
    list.append(li);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const day = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Hijack guard experiments (H8, H9): the newest log-only entries. */
function renderExperiments(experiments: Parameters<typeof describeExperiment>[0][]) {
  const details = document.getElementById("experiments") as HTMLDetailsElement;
  details.hidden = experiments.length === 0;
  if (experiments.length === 0) return;
  (document.getElementById("experiments-summary") as HTMLElement).textContent =
    `Pop-up experiments: would have stopped ${experiments.length}`;
  (document.getElementById("experiments-list") as HTMLUListElement).replaceChildren(
    ...experiments
      .slice(-20)
      .reverse()
      .map((e) => {
        const li = document.createElement("li");
        li.textContent = `${describeExperiment(e)} · ${day(e.at)}`; // text only
        return li;
      }),
  );
}

/** The Stage 2 shadow log: totals, pages that would have warned, and an export. */
async function renderShadow() {
  const entries = await listShadowEntries(browser.storage.local);
  const experiments = await listExperiments(browser.storage.local);
  renderExperiments(experiments);
  const s = shadowSummary(entries);
  const details = document.getElementById("shadow") as HTMLDetailsElement;
  details.hidden = s.total === 0;
  if (s.total === 0) return;
  (document.getElementById("shadow-summary") as HTMLElement).textContent =
    `Stage 2 log: ${plural(s.total, "login page", "login pages")} · would have warned on ${s.warns.length}`;
  (document.getElementById("shadow-counts") as HTMLElement).textContent =
    `Since ${day(s.since ?? Date.now())}: ${plural(s.gate, "password page", "password pages")}, ` +
    `${plural(s.identifier, "username step", "username steps")}, ${s.suspicious} suspicious.`;
  (document.getElementById("shadow-warns") as HTMLUListElement).replaceChildren(
    ...s.warns.map((w) => {
      const li = document.createElement("li");
      const site = document.createElement("strong");
      site.textContent = w.domain; // textContent only: site names come from web pages
      const why = document.createElement("span");
      why.textContent = `${describeSignals(w.signals)} · ${day(w.at)}`;
      li.title = w.page;
      li.append(site, why);
      return li;
    }),
  );
  (document.getElementById("shadow-export") as HTMLButtonElement).addEventListener("click", () => {
    const { filename, json } = shadowExport(entries, Date.now(), experiments);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });
}

async function main() {
  // `?tab=<id>` shows a specific tab (used by e2e; the popup isn't web-accessible).
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  const tab =
    Number.isInteger(forced) && forced > 0
      ? await browser.tabs.get(forced).catch(() => undefined)
      : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  await renderControls(tab);
  await renderShadow().catch((err) => console.error("[Warden] shadow log view failed", err));
  if (tab?.id === undefined) {
    show("none", "Not checked", "");
    return;
  }
  if (!(await readPrefs(browser.storage.local)).phishing) {
    show("none", "Phishing protection is off", "");
    return;
  }
  // Lookups fail open (no block), so say when protection has dropped to Warden's own lists.
  if (sbDegraded(await readSbHealth(browser.storage.session), Date.now())) {
    (document.getElementById("sb-degraded") as HTMLElement).hidden = false;
  }
  const verdict = await getTabVerdict(browser.storage.session, tab.id);

  // While the interstitial is showing, the tab URL is the warning page itself.
  const warningPage = browser.runtime.getURL("/warning.html");
  const shownUrl = tab.url?.startsWith(warningPage)
    ? parseWarningParams(new URL(tab.url).search)?.url
    : tab.url;

  // Fragment jumps don't trigger a new evaluation, and the fragment never reaches the server.
  if (!verdict || !shownUrl || withoutFragment(verdict.url) !== withoutFragment(shownUrl)) {
    show("none", "Not checked", "Warden only checks web pages on public sites.");
    return;
  }

  switch (verdict.decision) {
    case "block":
      show(
        "block",
        verdict.bypassed
          ? "Known phishing page (you chose to proceed)"
          : "Blocked: known phishing page",
        `Reported by ${sourceList(verdict) || "an unknown source"}.`,
      );
      break;
    case "escalate":
      // Escalations have no user-facing UI by design (docs/fp-policy.md).
      show("allow", "No known threats", "");
      break;
    default:
      show("allow", "No known threats", "This page isn't on any phishing list Warden uses.");
  }

  if (verdict.decision === "block") {
    report.hidden = false;
    report.addEventListener("click", async () => {
      report.disabled = true;
      await addFpReport(browser.storage.local, {
        url: verdict.url,
        decision: verdict.decision,
        sources: verdict.sources,
        at: Date.now(),
      });
      await browser.tabs.create({ url: reportIssueUrl(verdict.url, verdict.sources) });
      report.hidden = true;
      reportDone.hidden = false;
    });
  }
}

main().catch((err) => {
  console.error("[Warden] popup failed", err);
  show("none", "Not checked", "");
});
