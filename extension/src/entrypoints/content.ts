/**
 * Stage 2 content script, shadow mode. Checks the page's form fields (no text, links, or
 * values) for a secret-entry surface or an identifier-only login step, and tells the
 * background the counts. Login forms injected after load are caught by a time-boxed
 * MutationObserver. Nothing is shown to the user.
 *
 * On a login page (gated or identifier step) it also reads the title, headings, buttons,
 * labels, logo hints, and the hosts the page links to, to find which protected brand the
 * page claims (S2.6). Only the brand id and cue names are sent, and only on the device.
 */
import { bundledBrands } from "@warden/shared/brands";
import { extractFields, extractSnapshot, hasSecretSurface } from "@warden/shared/page/extract";
import { detectBrandClaim } from "@warden/shared/stage2/brand-claim";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import type { FieldsMessage } from "../lib/shadow-log.ts";

/** Watch for injected forms this long after load. */
const WATCH_MS = 10_000;
const DEBOUNCE_MS = 300;

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  allFrames: false,
  main() {
    let sentIdentifier = false;
    let sentGate = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const send = (message: FieldsMessage) => {
      browser.runtime.sendMessage(message).catch(() => {
        // The worker may be restarting; a missed shadow entry is fine.
      });
    };

    /** On login pages only: which protected brand the page presents itself as. */
    const withClaim = (message: FieldsMessage): FieldsMessage => {
      if (!bundledBrands) return message;
      try {
        const claim = detectBrandClaim(extractSnapshot(document), bundledBrands);
        return claim ? { ...message, brandClaim: claim } : message;
      } catch {
        return message; // no signal; the counts still go out
      }
    };

    const check = () => {
      if (sentGate) return;
      const fields = extractFields(document);
      const message: FieldsMessage = {
        type: "warden:fields",
        secrets: fields.secrets,
        identifierFields: fields.identifierFields,
      };
      if (hasSecretSurface(fields)) {
        sentGate = true;
        observer.disconnect();
        send(withClaim(message));
      } else if (fields.identifierFields > 0 && !sentIdentifier) {
        // Keep watching: a two-step login may reveal the password field on this same page.
        sentIdentifier = true;
        send(withClaim(message));
      }
    };

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(check, DEBOUNCE_MS);
    });
    check();
    if (!sentGate && document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        clearTimeout(timer);
      }, WATCH_MS);
    }
  },
});
