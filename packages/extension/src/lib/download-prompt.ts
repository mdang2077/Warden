/**
 * Forced-download prompt (H9): "Warden paused a download …" with Keep and Cancel, shown on
 * the page that started the download until the user picks one. Like the notice card it
 * lives in its own shadow root and shows page-supplied names as text only. One card per
 * paused download, stacked under each other.
 */

export const DOWNLOAD_ASK = "warden:download-ask";
export const DOWNLOAD_CHOICE = "warden:download-choice";
export const PROMPT_TAG = "warden-download-prompt";

export interface DownloadAsk {
  type: typeof DOWNLOAD_ASK;
  id: number;
  text: string;
}

export interface DownloadChoice {
  type: typeof DOWNLOAD_CHOICE;
  id: number;
  keep: boolean;
}

export function parseAsk(message: unknown): DownloadAsk | null {
  const m = message as Partial<DownloadAsk> | null;
  if (m?.type !== DOWNLOAD_ASK || !Number.isInteger(m.id) || typeof m.text !== "string")
    return null;
  return { type: DOWNLOAD_ASK, id: m.id as number, text: m.text.slice(0, 300) };
}

export function parseChoice(message: unknown): DownloadChoice | null {
  const m = message as Partial<DownloadChoice> | null;
  if (m?.type !== DOWNLOAD_CHOICE || !Number.isInteger(m.id) || typeof m.keep !== "boolean") {
    return null;
  }
  return { type: DOWNLOAD_CHOICE, id: m.id as number, keep: m.keep };
}

/** The card's wording. Sites and file types come from web pages: render as text only. */
export function askText(v: {
  reason: "installer" | "no-click";
  fileSite: string;
  fileType: string;
}) {
  const what = v.fileType ? `a .${v.fileType} file` : "a file";
  return v.reason === "installer"
    ? `Warden paused a download of ${what} from ${v.fileSite}. You didn't click a link to that site, and installers like this are a common trick. Keep it only if you meant to download it.`
    : `Warden paused a download of ${what} from ${v.fileSite} that this page started without a click on a link to it.`;
}

const STYLE = `
:host { all: initial; }
.stack {
  position: fixed; top: 16px; right: 16px; z-index: 2147483647;
  display: flex; flex-direction: column; gap: 8px;
  max-width: min(380px, calc(100vw - 32px));
}
.card {
  box-sizing: border-box; padding: 12px 14px;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1c1b1f; background: #ffffff;
  border: 1px solid #d6d2da; border-left: 4px solid #b3261e; border-radius: 10px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.18); overflow-wrap: anywhere;
}
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
button {
  font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif;
  padding: 6px 14px; border-radius: 6px; cursor: pointer;
  border: 1px solid #79747e; background: transparent; color: inherit;
}
button.cancel { background: #b3261e; border-color: #b3261e; color: #ffffff; }
button:focus-visible { outline: 2px solid #6750a4; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .card { color: #ede0e4; background: #2a2529; border-color: #4a4248; border-left-color: #f2b8b5; }
  button.cancel { background: #f2b8b5; border-color: #f2b8b5; color: #601410; }
}
`;

const stacks = new WeakMap<Document, { host: HTMLElement; stack: HTMLElement }>();

function stackFor(doc: Document): HTMLElement {
  const existing = stacks.get(doc);
  if (existing?.host.isConnected) return existing.stack;
  const host = doc.createElement(PROMPT_TAG);
  // Open, so automated tests can read it; the page could draw its own look-alike anyway.
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = STYLE;
  const stack = doc.createElement("div");
  stack.className = "stack";
  root.append(style, stack);
  (doc.body ?? doc.documentElement).append(host);
  stacks.set(doc, { host, stack });
  return stack;
}

/** Shows the card; `choose` is called once, with the user's answer. */
export function showDownloadPrompt(
  doc: Document,
  ask: { id: number; text: string },
  choose: (keep: boolean) => void,
): void {
  const stack = stackFor(doc);
  const card = doc.createElement("div");
  card.className = "card";
  card.setAttribute("role", "alertdialog");
  card.dataset.downloadId = String(ask.id);
  const message = doc.createElement("div");
  message.textContent = `🛡 ${ask.text}`;
  const actions = doc.createElement("div");
  actions.className = "actions";
  const keep = doc.createElement("button");
  keep.className = "keep";
  keep.textContent = "Keep";
  const cancel = doc.createElement("button");
  cancel.className = "cancel";
  cancel.textContent = "Cancel download";
  let done = false;
  const pick = (k: boolean) => {
    if (done) return;
    done = true;
    card.remove();
    choose(k);
  };
  keep.addEventListener("click", () => pick(true));
  cancel.addEventListener("click", () => pick(false));
  actions.append(keep, cancel);
  card.append(message, actions);
  stack.append(card);
  cancel.focus({ preventScroll: true });
}
