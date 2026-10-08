/**
 * When to re-check a page for login fields (Stage 2 gate, shadow mode). Phishing kits often
 * load the form hidden and reveal it later: behind a fake "loading" bar, a human-verification
 * check, or a "Log in" click. So besides added or removed nodes, a change to a visibility
 * attribute (style, class, hidden…) triggers a re-check while the page settles, and focusing a
 * form field triggers one for the page's lifetime (a focused field is visible by definition).
 */

/** Attributes whose changes can show or hide a form field. */
const VISIBILITY_ATTRS = ["style", "class", "hidden", "type", "aria-hidden", "open"];

export interface FieldWatchOptions {
  /** How long after load to watch DOM mutations. Field focus is watched for the page's lifetime. */
  watchMs?: number;
  /** At most one check per this many ms; a burst of mutations gets one trailing check. */
  throttleMs?: number;
}

/**
 * Calls `check` now, then again whenever the page may have revealed a form. `check` returns
 * true once it's done (the gate fired), which ends all watching. Returns a stop function.
 */
export function watchFields(
  doc: Document,
  check: () => boolean,
  { watchMs = 30_000, throttleMs = 300 }: FieldWatchOptions = {},
): () => void {
  let done = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let window: ReturnType<typeof setTimeout> | undefined;

  const onFocus = (e: Event) => {
    const t = e.target as Element | null;
    if (t?.matches?.("input, textarea, select")) schedule();
  };
  const observer = new MutationObserver(() => schedule());

  const stop = () => {
    done = true;
    observer.disconnect();
    doc.removeEventListener("focusin", onFocus, true);
    clearTimeout(pending);
    clearTimeout(window);
  };
  const run = () => {
    pending = undefined;
    if (!done && check()) stop();
  };
  // A throttle, not a debounce: an animation touching `style` every frame must not keep
  // pushing the check back until the window closes.
  function schedule() {
    if (done || pending !== undefined) return;
    pending = setTimeout(run, throttleMs);
  }

  run();
  if (done) return stop;
  if (doc.body) {
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: VISIBILITY_ATTRS,
    });
    window = setTimeout(() => observer.disconnect(), watchMs);
  }
  doc.addEventListener("focusin", onFocus, true);
  return stop;
}
