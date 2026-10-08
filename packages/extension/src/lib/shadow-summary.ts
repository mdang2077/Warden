/**
 * The popup's view of the Stage 2 shadow log: how many login pages Warden saw, and which ones
 * Stage 2 would have warned on. Those are the pages to check for false positives before
 * warnings are ever turned on. Entries logged before scoring existed count toward the totals
 * only.
 */
import type { ExperimentEntry } from "./hijack-experiments.ts";
import type { ShadowEntry } from "./shadow-log.ts";

export interface ShadowWarn {
  at: number;
  domain: string;
  page: string;
  signals: string[];
}

export interface ShadowSummary {
  total: number;
  /** Pages asking for a secret (password, code, card, seed phrase). */
  gate: number;
  /** Username- or email-only login steps. */
  identifier: number;
  /** One strong signal, not enough to warn. */
  suspicious: number;
  /** Oldest entry's time, or null for an empty log. */
  since: number | null;
  /** Pages Stage 2 would have warned on, newest first. */
  warns: ShadowWarn[];
}

export function shadowSummary(entries: readonly ShadowEntry[]): ShadowSummary {
  const warns = entries
    .filter((e) => e.score?.decision === "warn_candidate")
    .map((e) => ({
      at: e.at,
      domain: e.domain ?? new URL(e.page).hostname,
      page: e.page,
      signals: e.score?.signals ?? [],
    }))
    .sort((a, b) => b.at - a.at);
  return {
    total: entries.length,
    gate: entries.filter((e) => e.kind === "gate").length,
    identifier: entries.filter((e) => e.kind === "identifier").length,
    suspicious: entries.filter((e) => e.score?.decision === "suspicious").length,
    since: entries.length ? Math.min(...entries.map((e) => e.at)) : null,
    warns,
  };
}

const SIGNAL_LABELS: Record<string, string> = {
  "brandMismatch:1cue": "claims a brand (1 cue)",
  "brandMismatch:2cues": "claims a brand (2+ cues)",
  "exfil:telegram": "sends to Telegram",
  "exfil:discord": "sends to Discord",
  "exfil:formService": "sends to a form service",
  "exfil:crossSiteForm": "posts to another site",
  ipLookup: "looks up your IP",
  lookalike: "lookalike domain",
  brandKeyword: "brand name in address",
  ipHost: "IP address host",
  tenantPlatform: "free-hosting subdomain",
  deepSubdomain: "deep subdomain",
};

export function describeSignals(signals: readonly string[]): string {
  return signals.map((s) => SIGNAL_LABELS[s] ?? s).join(" + ");
}

export function shadowExport(
  entries: readonly ShadowEntry[],
  now: number,
  hijackExperiments: readonly ExperimentEntry[] = [],
): { filename: string; json: string } {
  const exported = new Date(now).toISOString();
  return {
    filename: `warden-shadow-log-${exported.slice(0, 10)}.json`,
    json: JSON.stringify({ exported, entries, hijackExperiments }, null, 2),
  };
}
