/**
 * EQTY-style truth tables. Two views of the same results:
 * - flagged: escalate, warn, or block counts as positive (anything Warden acted on or logged);
 * - block-only: only block counts as positive (what the user actually sees).
 */
import type { Decision } from "@warden/shared/types";
import type { UrlResult } from "./evaluate.ts";

export type View = "flagged" | "block";

export interface TruthTable {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export function isPositive(decision: Decision, view: View): boolean {
  return view === "block" ? decision === "block" : decision !== "allow";
}

export function truthTable(results: readonly UrlResult[], view: View): TruthTable {
  const t: TruthTable = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const r of results) {
    const pos = isPositive(r.decision, view);
    if (r.label === "phish") pos ? t.tp++ : t.fn++;
    else pos ? t.fp++ : t.tn++;
  }
  return t;
}

export function precision(t: TruthTable): number | null {
  return t.tp + t.fp ? t.tp / (t.tp + t.fp) : null;
}

export function recall(t: TruthTable): number | null {
  return t.tp + t.fn ? t.tp / (t.tp + t.fn) : null;
}

export function fpr(t: TruthTable): number | null {
  return t.fp + t.tn ? t.fp / (t.fp + t.tn) : null;
}

export function pct(x: number | null, digits = 2): string {
  return x === null ? "–" : `${(x * 100).toFixed(digits)}%`;
}
