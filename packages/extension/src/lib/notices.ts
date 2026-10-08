/**
 * Hijack guard notices: a short "Warden closed a pop-up to …" card on the page the user is
 * on, so a closed tab or an undone redirect doesn't look like a glitch. This module decides
 * the wording and which tab gets it; notice-card.ts draws it.
 *
 * - A closed pop-up is announced on the tab that opened it, right away.
 * - An undone redirect is announced on the page the tab went back to, so it waits for that
 *   page's commit (sending earlier could land on the junk page as it unloads).
 * - Blocks on one tab within NOTICE_GROUP_MS update one notice ("Warden closed 3 pop-ups").
 * - A notice the page couldn't receive yet (still loading) waits NOTICE_TTL_MS for the
 *   content script to collect it with `poll`.
 */
import { registrableDomain } from "@warden/shared/psl";
import type { HijackBlock } from "./hijack-action.ts";

export const NOTICE_GROUP_MS = 3_000;
export const NOTICE_TTL_MS = 5_000;

export const NOTICE_MESSAGE = "warden:notice";
export const NOTICE_POLL = "warden:notice-poll";

const site = (host: string) => registrableDomain(host) ?? host;

export function noticeText(blocks: readonly HijackBlock[]): string {
  const [first] = blocks;
  if (blocks.length === 1 && first) {
    return first.kind === "new-tab"
      ? `Warden closed a pop-up to ${site(first.destinationHost)}`
      : `Warden blocked a redirect to ${site(first.destinationHost)} and brought you back`;
  }
  const n = blocks.length;
  if (blocks.every((b) => b.kind === "new-tab")) return `Warden closed ${n} pop-ups`;
  if (blocks.every((b) => b.kind === "redirect")) return `Warden blocked ${n} redirects`;
  return `Warden blocked ${n} pop-ups and redirects`;
}

export interface NoticeDeps {
  /** Shows the text in the tab's page; false when no page was there to receive it. */
  send(tabId: number, text: string): Promise<boolean>;
  /** The popup setting "Show a notice when something is blocked". */
  enabled(): boolean;
  now?: () => number;
}

interface Pending {
  text: string;
  at: number;
  /** A redirect notice waits for the page the tab goes back to. */
  waiting: boolean;
}

export function createNotices(deps: NoticeDeps) {
  const now = deps.now ?? Date.now;
  const groups = new Map<number, { blocks: HijackBlock[]; last: number }>();
  const pending = new Map<number, Pending>();

  const deliver = async (tabId: number) => {
    const p = pending.get(tabId);
    if (!p || p.waiting) return;
    if (await deps.send(tabId, p.text).catch(() => false)) pending.delete(tabId);
  };

  return {
    async blocked(tabId: number, block: HijackBlock): Promise<void> {
      if (!deps.enabled()) return;
      const t = now();
      const group = groups.get(tabId);
      const blocks = group && t - group.last < NOTICE_GROUP_MS ? [...group.blocks, block] : [block];
      groups.set(tabId, { blocks, last: t });
      const waiting = block.kind === "redirect" || (pending.get(tabId)?.waiting ?? false);
      pending.set(tabId, { text: noticeText(blocks), at: t, waiting });
      await deliver(tabId);
    },

    /** Call for every top-frame commit that wasn't itself judged a hijack. */
    async committed(tabId: number): Promise<void> {
      const p = pending.get(tabId);
      if (!p?.waiting) return;
      p.waiting = false;
      p.at = now();
      await deliver(tabId);
    },

    /** A page that just loaded asks for a notice it missed; each notice is handed out once. */
    poll(tabId: number): string | null {
      const p = pending.get(tabId);
      if (!p || p.waiting) return null;
      pending.delete(tabId);
      return deps.enabled() && now() - p.at <= NOTICE_TTL_MS ? p.text : null;
    },

    forgetTab(tabId: number): void {
      groups.delete(tabId);
      pending.delete(tabId);
    },
  };
}

export type Notices = ReturnType<typeof createNotices>;

/** Validates a notice message from the worker: `{ type: "warden:notice", text }`. */
export function parseNotice(message: unknown): string | null {
  const m = message as { type?: unknown; text?: unknown } | null;
  if (m?.type !== NOTICE_MESSAGE || typeof m.text !== "string") return null;
  return m.text.slice(0, 200) || null;
}
