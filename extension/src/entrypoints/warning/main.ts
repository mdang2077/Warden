import { browser } from "wxt/browser";
import { parseWarningParams, SOURCE_LABELS } from "../../lib/interstitial.ts";
import { createOverrideStore } from "../../lib/overrides.ts";

const NEW_TAB = "chrome://newtab/";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const params = parseWarningParams(location.search);
const back = byId<HTMLButtonElement>("back");
const proceed = byId<HTMLButtonElement>("proceed");

// "Back to safety" opens a new tab page instead of history.back(): going back can land
// on the blocked page itself when it had already committed.
back.addEventListener("click", () => {
  void browser.tabs.update({ url: NEW_TAB });
});

// The page is web-accessible, so a site could frame it and trick a click on "Proceed".
const framed = window.top !== window;

if (!params || framed) {
  byId("blocked-url").textContent = params?.url ?? "(unknown)";
  byId("sources").textContent = "—";
  proceed.hidden = true;
} else {
  byId("blocked-url").textContent = params.url;
  byId("sources").textContent = params.sources.map((s) => SOURCE_LABELS[s]).join(", ") || "Unknown";
  byId("sb-attribution").hidden = !params.sources.includes("safe_browsing");

  const store = createOverrideStore(browser.storage.session);
  proceed.addEventListener("click", async () => {
    proceed.disabled = true;
    await store.addBypass(params.url, params.sources);
    location.replace(params.url);
  });
}

back.focus();
