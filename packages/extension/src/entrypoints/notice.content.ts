/**
 * Hijack guard notices: shows "Warden closed a pop-up to …" on the page for a few seconds
 * (notice-card.ts) when the worker says so, and on load asks for a notice it missed while
 * the page was still loading (an undone redirect lands on a page that is just loading).
 * Also shows the forced-download prompt (download-prompt.ts) with Keep / Cancel.
 * Top frame only; nothing is shown unless the hijack guard actually blocked something.
 */
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { DOWNLOAD_CHOICE, parseAsk, showDownloadPrompt } from "../lib/download-prompt.ts";
import { showNotice } from "../lib/notice-card.ts";
import { NOTICE_POLL, parseNotice } from "../lib/notices.ts";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  allFrames: false,
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const ask = parseAsk(message);
      if (ask) {
        showDownloadPrompt(document, ask, (keep) => {
          browser.runtime.sendMessage({ type: DOWNLOAD_CHOICE, id: ask.id, keep }).catch(() => {});
        });
        sendResponse(true); // the user is being asked
        return;
      }
      const text = parseNotice(message);
      if (!text) return;
      showNotice(document, text);
      sendResponse(true); // tells the worker the notice was shown
    });
    browser.runtime
      .sendMessage({ type: NOTICE_POLL })
      .then((reply) => {
        const text = parseNotice(reply);
        if (text) showNotice(document, text);
      })
      .catch(() => {
        // The worker may be restarting; a missed notice is fine.
      });
  },
});
