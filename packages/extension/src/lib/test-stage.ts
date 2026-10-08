/**
 * Stage used only by `wxt build --mode e2e`: blocks one reserved test host so the
 * Playwright smoke test can exercise the interstitial without real feed data.
 * `.example` is reserved (RFC 2606), so this can never match a real site.
 */
import type { Stage } from "@warden/shared/types";

export const E2E_BLOCKED_HOST = "phish.warden-test.example";

export const e2eTestStage: Stage = {
  id: "stage1_deterministic",
  async evaluate(ctx) {
    const hit = new URL(ctx.url).hostname === E2E_BLOCKED_HOST;
    return {
      decision: hit ? "block" : "allow",
      score: hit ? 1 : 0,
      signals: hit ? [{ id: "e2e_test_hit", source: "openphish", tier: "A" }] : [],
      latency_ms: 0,
      source: "stage1_deterministic",
    };
  },
};
