/**
 * "Report false positive" from the popup. Stage 1 only stores reports locally; sending
 * them to the service is a later phase.
 */
import type { Decision, SourceId } from "@warden/shared/types";
import type { KeyValueArea } from "./overrides.ts";

export interface FpReport {
  url: string;
  decision: Decision;
  sources: SourceId[];
  at: number;
}

const KEY = "fp_reports";
/** Oldest reports are dropped past this count. */
export const MAX_FP_REPORTS = 500;

export async function addFpReport(area: KeyValueArea, report: FpReport): Promise<void> {
  const existing = ((await area.get(KEY))[KEY] as FpReport[] | undefined) ?? [];
  await area.set({ [KEY]: [...existing, report].slice(-MAX_FP_REPORTS) });
}

export async function listFpReports(area: KeyValueArea): Promise<FpReport[]> {
  return ((await area.get(KEY))[KEY] as FpReport[] | undefined) ?? [];
}
