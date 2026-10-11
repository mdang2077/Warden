/**
 * S2.11 features: re-runs the shipping Stage 2 signal code over crawled login pages and
 * writes one JSON line per page (signal values only: no URL, host, title or HTML), so CI
 * can score the committed file without the corpora. The header's source hash ties the file
 * to the signal code that produced it.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ExfilSignal } from "@warden/shared/stage2/exfil-signal";
import type { ScoreInput } from "@warden/shared/stage2/score";
import type { UrlSignals } from "@warden/shared/stage2/url-signals";

export { featureRow, splitFor } from "./feature-row.ts";

export interface FeatureRow {
  label: "benign" | "phish";
  group: string;
  split: "tune" | "holdout";
  /** Secret-entry surface; false means an identifier-only step. */
  gated: boolean;
  allowlisted: boolean;
  brandMismatch: { cues: number } | null;
  exfil: ExfilSignal | null;
  url: UrlSignals;
  /** S2.9: the page skeleton matches a known kit (built from tune-split pages only). */
  kit: boolean;
}

export interface FeaturesHeader {
  header: true;
  schema: 1;
  sourceHash: string;
  generated: string;
  counts: { benign: number; phish: number; skipped: number };
}

/** Files (relative to the repo root) whose contents decide feature values. Not score.ts. */
export const SIGNAL_SOURCES: readonly string[] = [
  "packages/shared/src/page",
  "packages/shared/src/stage2",
  "packages/shared/src/brands.ts",
  "packages/shared/src/brands.json",
  "packages/shared/src/shared-hosts.ts",
  "packages/shared/src/shared-hosts.json",
  "packages/shared/src/psl.ts",
  "packages/shared/src/canonicalize.ts",
  // Which pages become rows and how their values are computed.
  "packages/eval/src/stage2/feature-row.ts",
  "packages/eval/src/stage2/saved-page.ts",
  "packages/eval/src/crawl/interception.ts",
  // Library versions that change values: the PSL (registrable domains) and the HTML parser.
  "packages/shared/node_modules/tldts/package.json",
  "packages/eval/node_modules/happy-dom/package.json",
];

const counted = (f: string) =>
  /\.(ts|json)$/.test(f) && !f.endsWith(".test.ts") && path.basename(f) !== "score.ts";

export function sourceHash(root: string, sources: readonly string[] = SIGNAL_SOURCES): string {
  const files: string[] = [];
  for (const s of sources) {
    const abs = path.join(root, s);
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs)) {
        if (counted(f) && statSync(path.join(abs, f)).isFile()) files.push(path.join(s, f));
      }
    } else if (counted(s)) files.push(s);
  }
  const h = createHash("sha256");
  for (const f of files.sort()) h.update(`${f}\0${readFileSync(path.join(root, f), "utf8")}\0`);
  return h.digest("hex");
}

/** `eligible` defaults to "not allowlisted" (no user trust in the eval). */
export function scoreInput(row: FeatureRow, eligible = !row.allowlisted): ScoreInput {
  return {
    brandMismatch: row.brandMismatch,
    exfil: row.exfil,
    url: row.url,
    kit: row.kit,
    gated: row.gated,
    eligible,
  };
}

export function serializeFeatures(header: FeaturesHeader, rows: readonly FeatureRow[]): string {
  return `${[header, ...rows].map((x) => JSON.stringify(x)).join("\n")}\n`;
}

const URL_KEYS = ["lookalike", "brandKeyword", "ipHost", "tenantPlatform", "deepSubdomain"];

const EXFIL_KINDS: readonly unknown[] = ["telegram", "discord", "formService", "crossSiteForm"];

function isRow(x: unknown): x is FeatureRow {
  const r = x as FeatureRow;
  return (
    (r?.label === "benign" || r?.label === "phish") &&
    typeof r.group === "string" &&
    (r.split === "tune" || r.split === "holdout") &&
    typeof r.gated === "boolean" &&
    typeof r.allowlisted === "boolean" &&
    typeof r.kit === "boolean" &&
    (r.brandMismatch === null || typeof r.brandMismatch?.cues === "number") &&
    (r.exfil === null ||
      (typeof r.exfil?.ip === "boolean" &&
        (r.exfil.kind === null || EXFIL_KINDS.includes(r.exfil.kind)))) &&
    URL_KEYS.every((k) => typeof (r.url as unknown as Record<string, unknown>)?.[k] === "boolean")
  );
}

export function parseFeatures(text: string): { header: FeaturesHeader; rows: FeatureRow[] } {
  const lines = text.split("\n").filter(Boolean);
  const json = (line: string, n: number): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`features: line ${n} is not valid JSON`);
    }
  };
  const header = lines[0] ? (json(lines[0], 1) as FeaturesHeader | null) : null;
  if (!header?.header || typeof header.sourceHash !== "string") {
    throw new Error("features: missing header line");
  }
  if (header.schema !== 1) throw new Error(`features: unknown schema ${String(header.schema)}`);
  const counts = header.counts as Partial<FeaturesHeader["counts"]> | undefined;
  if (typeof counts?.benign !== "number" || typeof counts.phish !== "number") {
    throw new Error("features: header has no row counts");
  }
  const rows = lines.slice(1).map((l, i) => {
    const row = json(l, i + 2);
    if (!isRow(row)) throw new Error(`features: malformed row on line ${i + 2}`);
    return row;
  });
  const tally = (label: FeatureRow["label"]) => rows.filter((r) => r.label === label).length;
  if (tally("benign") !== counts.benign || tally("phish") !== counts.phish) {
    throw new Error(
      `features: rows (${tally("benign")} benign, ${tally("phish")} phish) don't match the header's counts (${counts.benign}, ${counts.phish}); truncated file?`,
    );
  }
  return { header, rows };
}
