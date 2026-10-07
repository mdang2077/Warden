/**
 * Shared pieces of strict mode's click capture: the messages between the hijack-clicks
 * content script and the worker, and the "is this a real, visible link?" check. A link
 * only counts if a person could see it: near-transparent links and links covering most of
 * the viewport are the classic invisible overlay that sends a click to an ad.
 */
import type { ClickRecord } from "./hijack-detect.ts";

export const STRICT_QUERY = "warden:strict?";
export const MIN_LINK_OPACITY = 0.1;
export const MAX_LINK_VIEWPORT_SHARE = 0.6;

export interface ClickMessage {
  type: "warden:click";
  at: number;
  input: "pointer" | "key";
  linkHref: string | null;
}

/**
 * Holds clicks made before the worker has said whether this site is strict: listeners go
 * in at document_start, but the answer takes a round trip, and a hijack script often
 * fires on the very first click. On a strict site the held clicks are sent; otherwise
 * they are dropped and nothing is ever sent.
 */
export function createClickRelay(send: (message: ClickMessage) => void) {
  let strict: boolean | null = null;
  const pending: ClickMessage[] = [];
  return {
    record(message: ClickMessage): void {
      if (strict === true) send(message);
      else if (strict === null) pending.push(message);
    },
    resolve(isStrict: boolean): void {
      strict = isStrict;
      if (isStrict) for (const message of pending) send(message);
      pending.length = 0;
    },
  };
}

export function isStrictQuery(message: unknown): boolean {
  return (message as { type?: unknown } | null)?.type === STRICT_QUERY;
}

export function parseClickMessage(message: unknown): ClickRecord | null {
  const m = message as Partial<ClickMessage> | null;
  if (m?.type !== "warden:click" || typeof m.at !== "number") return null;
  if (m.input !== "pointer" && m.input !== "key") return null;
  if (m.linkHref !== null && typeof m.linkHref !== "string") return null;
  return { at: m.at, input: m.input, linkHref: m.linkHref };
}

export function visibleLinkHref(
  target: Element | null,
  view: Pick<Window, "innerWidth" | "innerHeight" | "getComputedStyle">,
): string | null {
  const link = target?.closest("a[href], area[href]") as
    | HTMLAnchorElement
    | HTMLAreaElement
    | null
    | undefined;
  if (!link) return null;

  let opacity = 1;
  for (let el: Element | null = link; el; el = el.parentElement) {
    const style = view.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return null;
    if (style.opacity !== "") opacity *= Number(style.opacity);
  }
  if (opacity < MIN_LINK_OPACITY) return null;

  const rect = link.getBoundingClientRect();
  const viewport = view.innerWidth * view.innerHeight;
  if (viewport > 0 && (rect.width * rect.height) / viewport >= MAX_LINK_VIEWPORT_SHARE) return null;
  return link.href;
}
