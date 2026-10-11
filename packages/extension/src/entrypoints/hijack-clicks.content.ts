/**
 * Hijack guard: records the user's real clicks so the worker can tell a link the user chose
 * from a click hijacked by the page (strict mode), and a file the user clicked a link to
 * from a forced download (download-guard.ts). Runs in every frame from document_start
 * (hijack scripts often live in the video player's cross-origin iframe). Listeners go in
 * immediately, but clicks are held until the worker says the guard runs on this site;
 * otherwise (guard off, or the site set to Allow) they are dropped and the listeners removed.
 *
 * Only the time, input kind, and the visible link's href are sent, to the local worker.
 * Nothing is stored and nothing leaves the device. Nothing is added to the page.
 */
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  type ClickMessage,
  createClickRelay,
  STRICT_QUERY,
  visibleLinkHref,
} from "../lib/click-capture.ts";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: true,
  async main() {
    const relay = createClickRelay((message) => {
      browser.runtime.sendMessage(message).catch(() => {});
    });
    const record = (input: ClickMessage["input"], target: Element | null) =>
      relay.record({
        type: "warden:click",
        at: Date.now(),
        input,
        linkHref: visibleLinkHref(target, window),
      });

    // Capture phase on window: runs before the page's own handlers can swap an href.
    const onPointer = (e: PointerEvent) => {
      if (e.isTrusted) record("pointer", e.target instanceof Element ? e.target : null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isTrusted && (e.key === "Enter" || e.key === " "))
        record("key", document.activeElement);
    };
    window.addEventListener("pointerdown", onPointer, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });

    let wanted = false;
    try {
      wanted = (await browser.runtime.sendMessage({ type: STRICT_QUERY })) === true;
    } catch {
      // worker unavailable: nothing is judged by clicks
    }
    relay.resolve(wanted);
    if (!wanted) {
      window.removeEventListener("pointerdown", onPointer, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
    }
  },
});
