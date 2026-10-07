/**
 * Page snapshot extractor: reads a rendered page's DOM into a `PageSnapshot`, the input to
 * every Stage 2 signal. The same code runs in the crawler (bundled and injected into the
 * page) and in the extension's content script, so eval numbers describe the shipping code.
 *
 * Read-only: it never submits, clicks, or modifies anything. Every list and text field is
 * capped, so a hostile page can't make the snapshot unbounded.
 */

export const SNAPSHOT_SCHEMA = 2;

const MAX_TEXT = 20_000;
const MAX_FORMS = 20;
const MAX_FIELDS = 50;
const MAX_ATTR = 200;
const MAX_LIST = 50;
const MAX_REF_HOSTS = 50;
const MAX_SHORT_LIST = 10;

export type SecretKind = "password" | "otp" | "card" | "seed";

export interface FieldInfo {
  tag: "input" | "textarea" | "select";
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  placeholder: string;
  /** Text of the associated <label>, aria-label, or aria-labelledby. */
  label: string;
  inputMode: string;
  maxLength: number | null;
  visible: boolean;
  /** Which secret this field asks for, if any. */
  secret: SecretKind | null;
}

export interface FormInfo {
  /** Resolved absolute action URL; the page URL when the form has no action. Empty for loose fields. */
  action: string;
  method: string;
  /** True for the pseudo-form that collects inputs outside any <form>. */
  loose: boolean;
  fields: FieldInfo[];
}

export interface PageSnapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  url: string;
  title: string;
  lang: string;
  /** Visible text, whitespace-collapsed, capped at MAX_TEXT characters. */
  text: string;
  forms: FormInfo[];
  /** Count of visible fields per secret kind across the page. */
  secrets: Record<SecretKind, number>;
  /**
   * Visible username/email/phone fields on a page with no secret field: the first step of a
   * two-step login. Not part of the gate; logged in shadow mode to measure the pattern.
   */
  identifierFields: number;
  favicon: string | null;
  /** img/svg sources or alt texts whose attributes mention "logo". */
  logoCandidates: string[];
  links: { total: number; external: number; empty: number };
  /** Off-site hostnames that links, form actions, and images point to; top 50 by count. */
  refHosts: { host: string; count: number }[];
  /** h1–h3 texts, up to 10, each clipped. */
  headings: string[];
  /** Button and submit/button-input texts, up to 10, each clipped. */
  buttons: string[];
  iframes: string[];
  scripts: { inline: number; external: string[] };
  metaRefresh: string | null;
}

const OTP_HINT =
  /\b(otp|one[\s_-]?time|2fa|mfa|two[\s_-]?factor|verification[\s_-]?code|security[\s_-]?code|auth(entication)?[\s_-]?code|sms[\s_-]?code|passcode|pin[\s_-]?code)\b/i;
const CARD_HINT =
  /(card[\s_-]?(number|num|no)|cc[\s_-]?(number|num|no)|credit[\s_-]?card|debit[\s_-]?card|\bcvv2?\b|\bcvc\b|\bcsc\b|security[\s_-]?number|expir(y|ation))/i;
const SEED_HINT = /\b(seed|recovery|mnemonic|secret|backup)[\s_-]?(phrase|words?)\b/i;

/** The cheap part of a snapshot: forms, fields, and secret counts. No text, links, or scripts. */
export type FieldsSnapshot = Pick<PageSnapshot, "url" | "forms" | "secrets" | "identifierFields">;

/** Runs on every page in the content script, so it stays to form fields only. */
export function extractFields(doc: Document): FieldsSnapshot {
  const url = doc.location?.href ?? doc.URL;
  const forms = collectForms(doc, url);
  const secrets: Record<SecretKind, number> = { password: 0, otp: 0, card: 0, seed: 0 };

  for (const form of forms) {
    // A row of 4-8 one-character boxes is a split OTP input.
    const singleChar = form.fields.filter(
      (f) => f.visible && f.tag === "input" && f.maxLength === 1 && f.secret === null,
    );
    if (singleChar.length >= 4 && singleChar.length <= 8) {
      for (const f of singleChar) f.secret = "otp";
    }
    // 12+ visible text boxes on a page that talks about a seed phrase is a seed grid.
    const textBoxes = form.fields.filter(
      (f) => f.visible && (f.tag === "textarea" || ["text", "password", ""].includes(f.type)),
    );
    if (textBoxes.length >= 12 && SEED_HINT.test(doc.body?.textContent ?? "")) {
      for (const f of textBoxes)
        if (f.secret === null || f.secret === "password") f.secret = "seed";
    }
    for (const f of form.fields) if (f.visible && f.secret) secrets[f.secret]++;
  }

  const anySecret = Object.values(secrets).some((n) => n > 0);
  const identifierFields = anySecret
    ? 0
    : forms.flatMap((f) => f.fields).filter((f) => f.visible && isIdentifier(f)).length;
  return { url, forms, secrets, identifierFields };
}

export function extractSnapshot(doc: Document): PageSnapshot {
  const { url, forms, secrets, identifierFields } = extractFields(doc);
  return {
    schema: SNAPSHOT_SCHEMA,
    url,
    title: clip(doc.title ?? "", MAX_ATTR),
    lang: clip(doc.documentElement?.getAttribute("lang") ?? "", 20),
    text: clip(collapse(visibleText(doc)), MAX_TEXT),
    forms,
    secrets,
    identifierFields,
    favicon: favicon(doc, url),
    logoCandidates: logoCandidates(doc, url),
    links: linkStats(doc, url),
    refHosts: refHosts(doc, url),
    headings: textsOf([...doc.querySelectorAll("h1, h2, h3")], (el) => el.textContent ?? ""),
    buttons: textsOf(
      [...doc.querySelectorAll("button, input")].filter(
        (el) =>
          el.tagName.toLowerCase() === "button" ||
          ["submit", "button"].includes((el.getAttribute("type") ?? "").toLowerCase()),
      ),
      (el) =>
        el.tagName.toLowerCase() === "button"
          ? (el.textContent ?? "")
          : (el.getAttribute("value") ?? ""),
    ),
    iframes: [...doc.querySelectorAll("iframe[src]")]
      .slice(0, MAX_LIST)
      .map((f) => absolute(f.getAttribute("src") ?? "", url))
      .filter(Boolean),
    scripts: scriptStats(doc, url),
    metaRefresh: metaRefresh(doc),
  };
}

/** True when the page asks for any secret: the Stage 2 credential gate. */
export function hasSecretSurface(snapshot: Pick<PageSnapshot, "secrets">): boolean {
  return Object.values(snapshot.secrets).some((n) => n > 0);
}

function collectForms(doc: Document, url: string): FormInfo[] {
  const out: FormInfo[] = [];
  for (const form of [...doc.querySelectorAll("form")].slice(0, MAX_FORMS)) {
    const rawAction = form.getAttribute("action");
    out.push({
      action: rawAction === null || rawAction.trim() === "" ? url : absolute(rawAction, url),
      method: (form.getAttribute("method") ?? "get").toLowerCase(),
      loose: false,
      fields: fieldsIn(doc, form.querySelectorAll("input, textarea, select")),
    });
  }
  const loose = [...doc.querySelectorAll("input, textarea, select")].filter(
    (el) => !el.closest("form"),
  );
  if (loose.length) out.push({ action: "", method: "", loose: true, fields: fieldsIn(doc, loose) });
  return out;
}

function fieldsIn(doc: Document, elements: Iterable<Element>): FieldInfo[] {
  const out: FieldInfo[] = [];
  for (const el of elements) {
    if (out.length >= MAX_FIELDS) break;
    const tag = el.tagName.toLowerCase() as FieldInfo["tag"];
    const type = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : tag;
    if (
      ["hidden", "submit", "button", "image", "reset", "checkbox", "radio", "file"].includes(type)
    ) {
      continue;
    }
    const maxAttr = el.getAttribute("maxlength");
    const field: FieldInfo = {
      tag,
      type,
      name: attr(el, "name"),
      id: attr(el, "id"),
      autocomplete: attr(el, "autocomplete").toLowerCase(),
      placeholder: attr(el, "placeholder"),
      label: labelFor(doc, el),
      inputMode: attr(el, "inputmode").toLowerCase(),
      maxLength: maxAttr !== null && /^\d+$/.test(maxAttr) ? Number(maxAttr) : null,
      visible: isVisible(el),
      secret: null,
    };
    field.secret = classify(field);
    out.push(field);
  }
  return out;
}

const IDENTIFIER_HINT = /\b(e-?mail|user(name)?|login|account|phone|mobile)\b/i;

function isIdentifier(f: FieldInfo): boolean {
  if (f.tag !== "input" || f.secret) return false;
  if (["username", "email", "tel"].includes(f.autocomplete)) return true;
  if (f.type === "email") return true;
  if (f.type !== "text" && f.type !== "tel") return false;
  return IDENTIFIER_HINT.test(`${f.name} ${f.id} ${f.placeholder} ${f.label}`);
}

function classify(f: FieldInfo): SecretKind | null {
  const hints = `${f.name} ${f.id} ${f.placeholder} ${f.label}`;
  if (f.autocomplete.startsWith("cc-") || CARD_HINT.test(hints)) return "card";
  if (f.autocomplete === "one-time-code" || OTP_HINT.test(hints)) return "otp";
  if (f.type === "password") return "password";
  if (f.autocomplete === "current-password" || f.autocomplete === "new-password") return "password";
  if (SEED_HINT.test(hints)) return "seed";
  return null;
}

function labelFor(doc: Document, el: Element): string {
  const parts: string[] = [];
  const aria = el.getAttribute("aria-label");
  if (aria) parts.push(aria);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const ref = doc.getElementById(id);
      if (ref?.textContent) parts.push(ref.textContent);
    }
  }
  const id = el.getAttribute("id");
  if (id) {
    for (const label of doc.querySelectorAll("label")) {
      if (label.getAttribute("for") === id && label.textContent) parts.push(label.textContent);
    }
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent) parts.push(wrapping.textContent);
  return clip(collapse(parts.join(" ")), MAX_ATTR);
}

/**
 * Whether a user could see the field. Autofill honeypots are often hidden without
 * `display`/`visibility`: transparent, tiny, or positioned off-screen. The size and position
 * checks need real layout, so they only apply where the document has it (browsers, not
 * DOM-only test environments).
 */
function isVisible(el: Element): boolean {
  if (el.hasAttribute("hidden")) return false;
  const view = el.ownerDocument.defaultView;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute("hidden")) return false;
    const style = view?.getComputedStyle(node);
    if (!style) continue;
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.opacity !== "" && Number(style.opacity) === 0) return false;
  }
  if (hasLayout(el.ownerDocument)) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    // Positions are relative to the viewport at load (scrolled to the top), so anything
    // fully above or left of it can never be scrolled into view.
    if (rect.right <= 0 || rect.bottom <= 0) return false;
  }
  return true;
}

function hasLayout(doc: Document): boolean {
  const root = doc.documentElement;
  return (
    typeof root?.getBoundingClientRect === "function" && root.getBoundingClientRect().width > 0
  );
}

function visibleText(doc: Document): string {
  const body = doc.body;
  if (!body) return "";
  // innerText respects CSS visibility in real browsers; textContent is the fallback.
  const inner = (body as HTMLElement).innerText;
  return typeof inner === "string" && inner.length ? inner : (body.textContent ?? "");
}

function favicon(doc: Document, url: string): string | null {
  // Attribute matching is done here rather than with `[attr i]` selectors, which not every
  // DOM implementation supports.
  const link = [...doc.querySelectorAll("link[rel]")].find((l) =>
    /(^|\s)icon(\s|$)/i.test(l.getAttribute("rel") ?? ""),
  );
  const href = link?.getAttribute("href");
  if (href) return absolute(href, url) || null;
  return absolute("/favicon.ico", url) || null;
}

function logoCandidates(doc: Document, url: string): string[] {
  const out: string[] = [];
  for (const img of doc.querySelectorAll("img, svg, [class], [id]")) {
    if (out.length >= MAX_LIST) break;
    const attrs = ["src", "alt", "class", "id", "aria-label"].map((a) => attr(img, a)).join(" ");
    if (!/logo/i.test(attrs)) continue;
    const src = img.getAttribute("src");
    const alt = img.getAttribute("alt") ?? img.getAttribute("aria-label");
    if (src) out.push(absolute(src, url));
    else if (alt) out.push(clip(alt, MAX_ATTR));
  }
  return out.filter(Boolean);
}

function linkStats(doc: Document, url: string): PageSnapshot["links"] {
  const host = hostOf(url);
  let total = 0;
  let external = 0;
  let empty = 0;
  for (const a of doc.querySelectorAll("a")) {
    total++;
    const href = (a.getAttribute("href") ?? "").trim();
    if (!href || href === "#" || /^javascript:/i.test(href)) {
      empty++;
      continue;
    }
    const target = hostOf(absolute(href, url));
    if (target && target !== host) external++;
  }
  return { total, external, empty };
}

function refHosts(doc: Document, url: string): PageSnapshot["refHosts"] {
  const own = hostOf(url);
  const counts = new Map<string, number>();
  const add = (raw: string | null) => {
    const value = (raw ?? "").trim();
    if (!value || value === "#") return;
    const host = hostOf(absolute(value, url));
    if (host && host !== own) counts.set(host, (counts.get(host) ?? 0) + 1);
  };
  for (const a of doc.querySelectorAll("a[href]")) add(a.getAttribute("href"));
  for (const f of doc.querySelectorAll("form[action]")) add(f.getAttribute("action"));
  for (const img of doc.querySelectorAll("img[src]")) add(img.getAttribute("src"));
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_REF_HOSTS)
    .map(([host, count]) => ({ host, count }));
}

function textsOf(elements: Element[], text: (el: Element) => string): string[] {
  const out: string[] = [];
  for (const el of elements) {
    if (out.length >= MAX_SHORT_LIST) break;
    const t = clip(collapse(text(el)), MAX_ATTR);
    if (t) out.push(t);
  }
  return out;
}

function scriptStats(doc: Document, url: string): PageSnapshot["scripts"] {
  let inline = 0;
  const external = new Set<string>();
  for (const s of doc.querySelectorAll("script")) {
    const src = s.getAttribute("src");
    if (!src) inline++;
    else if (external.size < MAX_LIST) external.add(absolute(src, url));
  }
  return { inline, external: [...external].filter(Boolean) };
}

function metaRefresh(doc: Document): string | null {
  const meta = [...doc.querySelectorAll("meta[http-equiv]")].find(
    (m) => (m.getAttribute("http-equiv") ?? "").toLowerCase() === "refresh",
  );
  const content = meta?.getAttribute("content");
  return content ? clip(content, MAX_ATTR) : null;
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function attr(el: Element, name: string): string {
  return clip(el.getAttribute(name) ?? "", MAX_ATTR);
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
