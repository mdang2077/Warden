/**
 * Stage 2 content script, shadow mode. Checks the page's form fields (no text, links, or
 * values) for a secret-entry surface or an identifier-only login step, and tells the
 * background the counts. Forms injected or revealed after load (a fake loading bar, a
 * human-verification step, a "Log in" click) are caught by field-watch.ts. Nothing is shown
 * to the user.
 *
 * On a login page (gated or identifier step) it also reads the title, headings, buttons,
 * labels, logo hints, and the hosts the page links to, to find which protected brand the
 * page claims (S2.6). Only the brand id and cue names are sent, and only on the device.
 * It also scans the page's scripts and form targets for where credentials would go (S2.7):
 * the endpoint kind and the hosts login forms post to go to the background, which stores
 * only the kind.
 */
import { bundledBrands } from "@warden/shared/brands";
import {
  extractBrandInput,
  extractExfilScripts,
  extractFields,
  type FormInfo,
  hasSecretSurface,
} from "@warden/shared/page/extract";
import { detectBrandClaim } from "@warden/shared/stage2/brand-claim";
import { scanExfil } from "@warden/shared/stage2/exfil-scan";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { watchFields } from "../lib/field-watch.ts";
import type { FieldsMessage } from "../lib/shadow-log.ts";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  allFrames: false,
  main() {
    let sentIdentifier = false;
    let sentGate = false;

    const send = (message: FieldsMessage) => {
      browser.runtime.sendMessage(message).catch(() => {
        // The worker may be restarting; a missed shadow entry is fine.
      });
    };

    /**
     * On login pages only: which protected brand the page presents itself as (S2.6), and
     * where credentials would be sent (S2.7). Each part fails on its own, to no signal.
     */
    const withClaim = (message: FieldsMessage, forms: FormInfo[]): FieldsMessage => {
      let out = message;
      if (bundledBrands) {
        try {
          const claim = detectBrandClaim(extractBrandInput(document, forms), bundledBrands);
          if (claim) out = { ...out, brandClaim: claim };
        } catch {
          // no brand signal; the counts still go out
        }
      }
      try {
        const exfil = scanExfil({ forms, ...extractExfilScripts(document) });
        if (exfil.endpoint || exfil.ip || exfil.formHosts.length) out = { ...out, exfil };
      } catch {
        // no exfil signal
      }
      return out;
    };

    /** True once the gate has fired: nothing more to watch for on this page. */
    const check = (): boolean => {
      if (sentGate) return true;
      const fields = extractFields(document);
      const message: FieldsMessage = {
        type: "warden:fields",
        secrets: fields.secrets,
        identifierFields: fields.identifierFields,
      };
      if (hasSecretSurface(fields)) {
        sentGate = true;
        send(withClaim(message, fields.forms));
      } else if (fields.identifierFields > 0 && !sentIdentifier) {
        // Keep watching: a two-step login may reveal the password field on this same page.
        sentIdentifier = true;
        send(withClaim(message, fields.forms));
      }
      return sentGate;
    };

    watchFields(document, check);
  },
});
