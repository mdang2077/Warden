import { browser } from "wxt/browser";
import { addFpReport } from "../../lib/fp-reports.ts";
import { getHijackRecord } from "../../lib/hijack-action.ts";
import { parseWarningParams, SOURCE_LABELS } from "../../lib/interstitial.ts";
import {
  readPrefs,
  type SiteMode,
  siteKey,
  siteMode,
  updatePrefs,
  withSiteMode,
} from "../../lib/popup-prefs.ts";
import { blockedView } from "../../lib/popup-view.ts";
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

/** Toggles, the per-site popup mode, and the "blocked on this page" list. */
async function renderControls(
  tab: { id?: number | undefined; url?: string | undefined } | undefined,
) {
  const area = browser.storage.local;
  const prefs = await readPrefs(area);
  const phishing = document.getElementById("toggle-phishing") as HTMLInputElement;
  const hijack = document.getElementById("toggle-hijack") as HTMLInputElement;
  phishing.checked = prefs.phishing;
  hijack.checked = prefs.hijack;
  phishing.addEventListener("change", () => {
    void updatePrefs(area, (p) => ({ ...p, phishing: phishing.checked }));
  });
  hijack.addEventListener("change", () => {
    void updatePrefs(area, (p) => ({ ...p, hijack: hijack.checked }));
  });

  const site = tab?.url ? siteKey(tab.url) : null;
  await renderTrust(site);
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

async function main() {
  // `?tab=<id>` shows a specific tab (used by e2e; the popup isn't web-accessible).
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  const tab =
    Number.isInteger(forced) && forced > 0
      ? await browser.tabs.get(forced).catch(() => undefined)
      : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  await renderControls(tab);
  if (tab?.id === undefined) {
    show("none", "Not checked", "");
    return;
  }
  if (!(await readPrefs(browser.storage.local)).phishing) {
    show("none", "Phishing protection is off", "");
    return;
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
      report.hidden = true;
      reportDone.hidden = false;
    });
  }
}

main().catch((err) => {
  console.error("[Warden] popup failed", err);
  show("none", "Not checked", "");
});
