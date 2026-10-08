/**
 * S2.11 Stage 2 harness. `extract` re-runs the shipping signal code over the crawl corpora
 * (needs them locally) and writes the features file; `score` scores that file into
 * STAGE2_SCORE.md, and with --check is the CI gate (no corpora, network or browser needed).
 *
 *   node packages/eval/src/stage2/harness.ts extract [--benign DIR] [--phish DIR] [--index FILE]
 *     [--allowlist TRANCO_TXT] [--out packages/eval/data/stage2-features.jsonl]
 *   node packages/eval/src/stage2/harness.ts score [--features FILE] [--out packages/eval/reports/STAGE2_SCORE.md] [--check]
 *
 * Workflow when a signal changes: rerun `extract`, commit the features file and report.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseAllowlist } from "@warden/shared/allowlist";
import { bundledSharedHosts } from "@warden/shared/shared-hosts";
import { score } from "@warden/shared/stage2/score";
import {
  type FeatureRow,
  featureRow,
  parseFeatures,
  scoreInput,
  serializeFeatures,
  sourceHash,
} from "./features.ts";
import { loadRecords } from "./gate-report.ts";
import { gateFailures, renderScoreReport } from "./score-report.ts";

const EVAL = path.resolve(import.meta.dirname, "../..");
const ROOT = path.resolve(EVAL, "../..");

export async function runScore(opts: {
  features: string;
  out: string;
  check: boolean;
  root: string;
}): Promise<number> {
  let parsed: ReturnType<typeof parseFeatures>;
  try {
    parsed = parseFeatures(readFileSync(opts.features, "utf8"));
  } catch (err) {
    console.error(`[stage2] ${(err as Error).message} (${opts.features})`);
    return 1;
  }
  await mkdir(path.dirname(opts.out), { recursive: true });
  await writeFile(opts.out, renderScoreReport(parsed.rows, parsed.header));
  console.log(`wrote ${opts.out}`);
  if (!opts.check) return 0;
  const failures = gateFailures(parsed.rows, parsed.header, sourceHash(opts.root));
  for (const f of failures) console.error(`[stage2] gate FAIL: ${f}`);
  if (!failures.length) console.log("[stage2] gate PASS");
  return failures.length ? 1 : 0;
}

async function runExtract(values: Record<string, string | boolean | undefined>): Promise<void> {
  const allowlist = parseAllowlist(
    readFileSync(values.allowlist as string, "utf8"),
    bundledSharedHosts,
  );
  const allows = (h: string) => allowlist.allows(h);
  const index = values.index as string | undefined;
  const keep =
    index && existsSync(index)
      ? new Set(
          readFileSync(index, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => (JSON.parse(l) as { id: string }).id),
        )
      : null;
  const rows: FeatureRow[] = [];
  let skipped = 0;
  for (const [dir, filter] of [
    [values.benign as string, (_id: string) => true],
    [values.phish as string, (id: string) => !keep || keep.has(id)],
  ] as const) {
    for (const r of loadRecords(dir).filter((x) => filter(x.id))) {
      const out = await featureRow(r, dir, allows);
      if (out === null) continue;
      if (out === "skip") {
        skipped++;
        continue;
      }
      rows.push(out.row);
      if (
        out.row.label === "benign" &&
        score(scoreInput(out.row, true)).rawDecision === "warn_candidate"
      ) {
        console.error(`[stage2] benign warn candidate (raw): ${out.host} [${out.row.group}]`);
      }
    }
  }
  const count = (l: FeatureRow["label"]) => rows.filter((r) => r.label === l).length;
  const header = {
    header: true as const,
    schema: 1 as const,
    sourceHash: sourceHash(ROOT),
    generated: new Date().toISOString(),
    counts: { benign: count("benign"), phish: count("phish"), skipped },
  };
  await mkdir(path.dirname(values.out as string), { recursive: true });
  await writeFile(values.out as string, serializeFeatures(header, rows));
  console.log(
    `wrote ${values.out}: ${header.counts.benign} benign, ${header.counts.phish} phish, ${skipped} skipped${keep ? " (phish filtered by --index)" : ""}`,
  );
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "extract") {
    const { values } = parseArgs({
      args: rest,
      options: {
        benign: { type: "string", default: path.join(EVAL, "corpora", "crawl-benign") },
        phish: { type: "string", default: path.join(EVAL, "corpora", "docker", "crawl") },
        index: {
          type: "string",
          default: path.join(EVAL, "corpora", "docker", "crawl", "index.jsonl"),
        },
        allowlist: {
          type: "string",
          default: path.join(EVAL, "corpora", "tranco-Y83KG-100000.txt"),
        },
        out: { type: "string", default: path.join(EVAL, "data", "stage2-features.jsonl") },
      },
    });
    await runExtract(values);
  } else if (command === "score") {
    const { values } = parseArgs({
      args: rest,
      options: {
        features: { type: "string", default: path.join(EVAL, "data", "stage2-features.jsonl") },
        out: { type: "string", default: path.join(EVAL, "reports", "STAGE2_SCORE.md") },
        check: { type: "boolean", default: false },
      },
    });
    process.exitCode = await runScore({
      features: values.features,
      out: values.out,
      check: values.check,
      root: ROOT,
    });
  } else {
    console.error("usage: harness.ts extract|score [options] (see the file header)");
    process.exitCode = 2;
  }
}
