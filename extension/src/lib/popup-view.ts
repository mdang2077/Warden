/** Formatting for the toolbar popup's "Blocked on this page" list. */
import type { TabHijackRecord } from "./hijack-action.ts";

export interface BlockedRow {
  host: string;
  kind: "new tab" | "redirect";
  age: string;
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1_000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function blockedView(
  record: TabHijackRecord | null,
  now: number,
): { summary: string; rows: BlockedRow[] } | null {
  if (!record || record.blocks.length === 0) return null;
  return {
    summary: `Blocked ${record.blocks.length} on this page`,
    rows: [...record.blocks].reverse().map((b) => ({
      host: b.destinationHost,
      kind: b.kind === "new-tab" ? "new tab" : "redirect",
      age: formatAge(now - b.at),
    })),
  };
}
