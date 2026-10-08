import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type FeatureRow, serializeFeatures, sourceHash } from "./features.ts";
import { runExtract, runScore } from "./harness.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const NO_URL = {
  lookalike: false,
  brandKeyword: false,
  ipHost: false,
  tenantPlatform: false,
  deepSubdomain: false,
};
const row: FeatureRow = {
  label: "benign",
  group: "tranco-login",
  split: "tune",
  gated: true,
  allowlisted: true,
  brandMismatch: null,
  exfil: null,
  url: NO_URL,
};

function features(hash: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "warden-harness-"));
  const file = path.join(dir, "f.jsonl");
  writeFileSync(
    file,
    serializeFeatures(
      {
        header: true,
        schema: 1,
        sourceHash: hash,
        generated: "2026-10-07T00:00:00.000Z",
        counts: { benign: 1, phish: 0, skipped: 0 },
      },
      [row],
    ),
  );
  return file;
}

describe("runScore", () => {
  it("writes the report and exits 0 when the gate passes", async () => {
    const file = features(sourceHash(ROOT));
    const out = path.join(path.dirname(file), "nested", "REPORT.md");
    expect(await runScore({ features: file, out, check: true, root: ROOT })).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("# Stage 2 score report (S2.11)");
  });

  it("exits 1 under --check when the source hash is stale", async () => {
    const file = features("stale");
    const out = path.join(path.dirname(file), "R.md");
    expect(await runScore({ features: file, out, check: true, root: ROOT })).toBe(1);
    expect(await runScore({ features: file, out, check: false, root: ROOT })).toBe(0);
  });

  it("exits 1 under --check on an unreadable features file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "warden-harness-"));
    const file = path.join(dir, "bad.jsonl");
    writeFileSync(file, "not json\n");
    expect(
      await runScore({ features: file, out: path.join(dir, "R.md"), check: true, root: ROOT }),
    ).toBe(1);
  });

  it("exits 1 when a corpus directory is missing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "warden-harness-"));
    const code = await runExtract({
      benign: path.join(dir, "no-such-benign"),
      phish: path.join(dir, "no-such-phish"),
      allowlist: path.join(dir, "tranco.txt"),
      out: path.join(dir, "f.jsonl"),
    });
    expect(code).toBe(1);
  });
});
