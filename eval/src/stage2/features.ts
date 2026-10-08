/**
 * S2.11 features: re-runs the shipping Stage 2 signal code over crawled login pages and
 * writes one JSON line per page (signal values only: no URL, host, title or HTML), so CI
 * can score the committed file without the corpora. The header's source hash ties the file
 * to the signal code that produced it.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { bundledBrands } from "@warden/shared/brands";
import { canonicalize } from "@warden/shared/canonicalize";
import { extractBrandInput, extractExfilScripts } from "@warden/shared/page/extract";
import { registrableDomain } from "@warden/shared/psl";
import { bundledSharedHosts } from "@warden/shared/shared-hosts";
import { detectBrandClaim } from "@warden/shared/stage2/brand-claim";
import { brandMismatch } from "@warden/shared/stage2/brand-mismatch";
import { scanExfil } from "@warden/shared/stage2/exfil-scan";
import { type ExfilSignal, exfilSignal } from "@warden/shared/stage2/exfil-signal";
import type { ScoreInput } from "@warden/shared/stage2/score";
import { type UrlSignals, urlSignals } from "@warden/shared/stage2/url-signals";
import type { CrawlRecord } from "../crawl/crawler.ts";
import { classifyInterception } from "../crawl/interception.ts";
import { parseSavedPage } from "./saved-page.ts";

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
}

export interface FeaturesHeader {
  header: true;
  schema: 1;
  sourceHash: string;
  generated: string;
  counts: { benign: number; phish: number; skipped: number };
}

/** Files (relative to the repo root) whose contents decide signal values. Not score.ts. */
export const SIGNAL_SOURCES: readonly string[] = [
  "shared/src/page",
  "shared/src/stage2",
  "shared/src/brands.ts",
  "shared/src/brands.json",
  "shared/src/shared-hosts.ts",
  "shared/src/shared-hosts.json",
  "shared/src/psl.ts",
  "shared/src/canonicalize.ts",
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

/** ~30% of sites held out; every page of one site lands in the same split. */
export function splitFor(host: string): "tune" | "holdout" {
  const site = registrableDomain(host) ?? host;
  return (createHash("sha256").update(site).digest()[0] ?? 0) < 77 ? "holdout" : "tune";
}

export async function featureRow(
  r: CrawlRecord,
  dir: string,
  allowlisted: (host: string) => boolean,
): Promise<{ row: FeatureRow; host: string } | "skip" | null> {
  if (!r.ok || !r.snapshot || classifyInterception(r)) return null;
  const identifier = !r.gated && (r.snapshot.identifierFields ?? 0) > 0;
  if (!r.gated && !identifier) return null;
  const file = path.join(dir, r.id, "page.html");
  if (!existsSync(file)) return "skip";
  const raw = r.final_url ?? r.url;
  const canon = canonicalize(raw);
  const host = canon?.host ?? new URL(raw).hostname;
  let input: ReturnType<typeof extractBrandInput>;
  let scripts: ReturnType<typeof extractExfilScripts>;
  try {
    const page = parseSavedPage(readFileSync(file, "utf8"), raw);
    input = extractBrandInput(page.doc);
    scripts = extractExfilScripts(page.doc);
    await page.close();
  } catch {
    return "skip";
  }
  const brands = bundledBrands;
  const claim = brands ? detectBrandClaim(input, brands) : null;
  return {
    host,
    row: {
      label: r.label,
      group: r.group,
      split: splitFor(host),
      gated: r.gated,
      allowlisted: allowlisted(host),
      brandMismatch:
        claim && brands && brandMismatch(claim, host, brands) ? { cues: claim.cues.length } : null,
      exfil: exfilSignal(scanExfil({ forms: input.forms, ...scripts }), host),
      url: urlSignals(canon, brands, bundledSharedHosts),
    },
  };
}

/** `eligible` defaults to "not allowlisted" (no user trust in the eval). */
export function scoreInput(row: FeatureRow, eligible = !row.allowlisted): ScoreInput {
  return {
    brandMismatch: row.brandMismatch,
    exfil: row.exfil,
    url: row.url,
    gated: row.gated,
    eligible,
  };
}

export function serializeFeatures(header: FeaturesHeader, rows: readonly FeatureRow[]): string {
  return `${[header, ...rows].map((x) => JSON.stringify(x)).join("\n")}\n`;
}

const URL_KEYS = ["lookalike", "brandKeyword", "ipHost", "tenantPlatform", "deepSubdomain"];

function isRow(x: unknown): x is FeatureRow {
  const r = x as FeatureRow;
  return (
    (r?.label === "benign" || r?.label === "phish") &&
    typeof r.group === "string" &&
    (r.split === "tune" || r.split === "holdout") &&
    typeof r.gated === "boolean" &&
    typeof r.allowlisted === "boolean" &&
    (r.brandMismatch === null || typeof r.brandMismatch?.cues === "number") &&
    (r.exfil === null || typeof r.exfil?.ip === "boolean") &&
    URL_KEYS.every((k) => typeof (r.url as unknown as Record<string, unknown>)?.[k] === "boolean")
  );
}

export function parseFeatures(text: string): { header: FeaturesHeader; rows: FeatureRow[] } {
  const lines = text.split("\n").filter(Boolean);
  const header = lines[0] ? (JSON.parse(lines[0]) as FeaturesHeader) : null;
  if (!header?.header || typeof header.sourceHash !== "string") {
    throw new Error("features: missing header line");
  }
  const rows = lines.slice(1).map((l, i) => {
    const row = JSON.parse(l) as unknown;
    if (!isRow(row)) throw new Error(`features: malformed row on line ${i + 2}`);
    return row;
  });
  return { header, rows };
}
