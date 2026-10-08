/**
 * The hijack guard's notice card: a small "Warden closed a pop-up to …" message in the
 * top-right corner of the page for a few seconds. It lives in its own shadow root, so the
 * page's styles can't restyle it, and the message is set as text only (it contains host
 * names from web pages). One card per page: a new notice updates it and restarts its timer.
 */

export const NOTICE_TAG = "warden-notice";
export const NOTICE_MS = 3_000;
const FADE_MS = 200;

const STYLE = `
:host { all: initial; }
.card {
  position: fixed; top: 16px; right: 16px; z-index: 2147483647;
  max-width: min(360px, calc(100vw - 32px));
  box-sizing: border-box; padding: 10px 14px;
  display: flex; gap: 8px; align-items: flex-start;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1c1b1f; background: #ffffff;
  border: 1px solid #d6d2da; border-radius: 10px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
  cursor: pointer; overflow-wrap: anywhere;
  opacity: 0; transform: translateY(-6px);
  transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
}
.card.shown { opacity: 1; transform: none; }
.icon { flex: none; font-size: 14px; }
@media (prefers-color-scheme: dark) {
  .card { color: #ede0e4; background: #2a2529; border-color: #4a4248; }
}
@media (prefers-reduced-motion: reduce) {
  .card { transition: none; transform: none; }
}
`;

interface Card {
  host: HTMLElement;
  card: HTMLElement;
  message: HTMLElement;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const cards = new WeakMap<Document, Card>();

function build(doc: Document): Card {
  const host = doc.createElement(NOTICE_TAG);
  // Open, so automated tests can read it; the page could draw its own look-alike anyway.
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = STYLE;
  const card = doc.createElement("div");
  card.className = "card";
  const icon = doc.createElement("span");
  icon.className = "icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "🛡";
  const message = doc.createElement("span");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  card.append(icon, message);
  root.append(style, card);
  return { host, card, message, timer: undefined };
}

function hide(doc: Document, c: Card) {
  clearTimeout(c.timer);
  c.card.classList.remove("shown");
  c.timer = setTimeout(() => {
    c.host.remove();
    cards.delete(doc);
  }, FADE_MS);
}

export function showNotice(
  doc: Document,
  text: string,
  { durationMs = NOTICE_MS }: { durationMs?: number } = {},
): void {
  let c = cards.get(doc);
  // A page that rewrites its body removes the card; start a fresh one.
  if (!c?.host.isConnected) {
    if (c) clearTimeout(c.timer);
    const fresh = build(doc);
    fresh.card.addEventListener("click", () => hide(doc, fresh));
    (doc.body ?? doc.documentElement).append(fresh.host);
    cards.set(doc, fresh);
    c = fresh;
  }
  const current = c;
  current.message.textContent = text;
  clearTimeout(current.timer);
  // Next frame, so the fade-in transition runs from the hidden state.
  requestAnimationFrame(() => current.card.classList.add("shown"));
  current.timer = setTimeout(() => hide(doc, current), durationMs);
}
