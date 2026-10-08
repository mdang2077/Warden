/**
 * The shipping brand detector's first call in a fresh process. A content script starts cold
 * on every page, so first-use cost is page-load cost. Lives here (not in packages/shared/) because it
 * spawns Node.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const shared = path.resolve(import.meta.dirname, "../../../shared/src");

describe("brand detector cold start", () => {
  it("first use in a fresh process is fast", () => {
    const script = `
      const { detectBrandClaim } = await import(${JSON.stringify(path.join(shared, "stage2/brand-claim.ts"))});
      const { bundledBrands } = await import(${JSON.stringify(path.join(shared, "brands.ts"))});
      const input = { title: "Sign in to your account", headings: ["Welcome back"],
        buttons: ["Log in", "Continue with Google"], forms: [] };
      const t = performance.now();
      detectBrandClaim(input, bundledBrands);
      console.log(performance.now() - t);`;
    const ms = Number(
      execFileSync(process.execPath, ["--input-type=module", "-e", script]).toString(),
    );
    expect(ms).toBeLessThan(60);
  });
});
