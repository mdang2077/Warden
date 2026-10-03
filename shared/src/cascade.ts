/**
 * Cascade runner: runs stages in order, cheapest first, and stops early on `block`
 * or on a result marked `final`. Every failure is fail-open: a stage that throws or
 * runs past the remaining time budget contributes `allow`.
 */
import { capStageResult, maxDecision } from "./risk.ts";
import type { Decision, NavigationContext, Stage, StageResult } from "./types.ts";

export interface CascadeOptions {
  /** Total wall-clock budget for all stages, in milliseconds. */
  budgetMs: number;
  /** Clock override for tests. */
  now?: () => number;
}

export interface CascadeResult {
  decision: Decision;
  /** One entry per stage that ran, in order, already capped. */
  results: StageResult[];
  total_ms: number;
  /** True when the budget ran out before every stage had a chance to run. */
  timed_out: boolean;
}

const TIMEOUT = Symbol("timeout");

export async function runCascade(
  stages: readonly Stage[],
  ctx: NavigationContext,
  options: CascadeOptions,
): Promise<CascadeResult> {
  const now = options.now ?? (() => performance.now());
  const start = now();
  const results: StageResult[] = [];
  let decision: Decision = "allow";
  let timedOut = false;

  for (const stage of stages) {
    const remaining = options.budgetMs - (now() - start);
    if (remaining <= 0) {
      timedOut = true;
      break;
    }

    const stageStart = now();
    let result: StageResult;
    try {
      const outcome = await withTimeout(stage.evaluate(ctx, [...results]), remaining);
      if (outcome === TIMEOUT) {
        timedOut = true;
        results.push(failOpen(stage, now() - stageStart, "timeout"));
        break;
      }
      result = { ...capStageResult(outcome), latency_ms: now() - stageStart };
    } catch (err) {
      result = failOpen(stage, now() - stageStart, String(err));
    }

    results.push(result);
    decision = maxDecision(decision, result.decision);
    if (result.decision === "block" || result.final) break;
  }

  return { decision, results, total_ms: now() - start, timed_out: timedOut };
}

function failOpen(stage: Stage, latencyMs: number, error: string): StageResult {
  return {
    decision: "allow",
    score: 0,
    signals: [],
    latency_ms: latencyMs,
    source: stage.id,
    error,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
