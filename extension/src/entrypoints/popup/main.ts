import { browser } from "wxt/browser";
import { addFpReport } from "../../lib/fp-reports.ts";
import { parseWarningParams, SOURCE_LABELS } from "../../lib/interstitial.ts";
import { getTabVerdict, type TabVerdict } from "../../lib/tab-state.ts";

const status = document.getElementById("status") as HTMLElement;
const detail = document.getElementById("detail") as HTMLElement;
const report = document.getElementById("report") as HTMLButtonElement;
const reportDone = document.getElementById("report-done") as HTMLElement;

function show(decision: string, title: string, text: string) {
  status.dataset.decision = decision;
  status.textContent = title;
  detail.textContent = text;
}

function sourceList(verdict: TabVerdict): string {
  return verdict.sources.map((s) => SOURCE_LABELS[s]).join(", ");
}

async function main() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    show("none", "Not checked", "");
    return;
  }
  const verdict = await getTabVerdict(browser.storage.session, tab.id);

  // While the interstitial is showing, the tab URL is the warning page itself.
  const warningPage = browser.runtime.getURL("/warning.html");
  const shownUrl = tab.url?.startsWith(warningPage)
    ? parseWarningParams(new URL(tab.url).search)?.url
    : tab.url;

  if (!verdict || verdict.url !== shownUrl) {
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
