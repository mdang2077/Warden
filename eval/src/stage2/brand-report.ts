/**
 * Stage 2 brand–domain mismatch report (S2.6): re-runs the shipping extractor (schema 2)
 * over the crawl's saved page.html and measures the brand signal on the Stage 2 surface:
 * pages the crawl found gated or at an identifier step (recorded in the real browser).
 *
 *   node eval/src/stage2/brand-report.ts [--benign DIR] [--phish DIR] [--index FILE]
 *     [--allowlist TRANCO_TXT] [--out eval/reports/STAGE2_BRAND.md]
 *
 * `--index` keeps only phish records whose id appears in that index.jsonl (e.g. the droplet
 * crawl's). Saved HTML is parsed with scripts disabled; it's attacker-controlled.
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseAllowlist } from "@warden/shared/allowlist";
import { type BrandList, bundledBrands } from "@warden/shared/brands";
import { extractBrandInput } from "@warden/shared/page/extract";
import { bundledSharedHosts } from "@warden/shared/shared-hosts";
import {
  type BrandClaim,
  type BrandInput,
  type ClaimThresholds,
  DEFAULT_THRESHOLDS,
  detectBrandClaim,
} from "@warden/shared/stage2/brand-claim";
import { brandMismatch } from "@warden/shared/stage2/brand-mismatch";
import { Window } from "happy-dom";
import type { CrawlRecord } from "../crawl/crawler.ts";
import { classifyInterception } from "../crawl/interception.ts";
import { loadRecords } from "./gate-report.ts";

export interface BrandRow {
  group: string;
  label: string;
  host: string;
  title: string;
  kind: "gate" | "identifier";
  input: BrandInput;
  allowlisted: boolean;
}

export function judge(
  row: BrandRow,
  brands: BrandList,
  t: ClaimThresholds = DEFAULT_THRESHOLDS,
): { claim: BrandClaim | null; mismatch: boolean } {
  const claim = detectBrandClaim(row.input, brands, t);
  return { claim, mismatch: claim !== null && brandMismatch(claim, row.host, brands) };
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "–");

function groupTable(rows: BrandRow[], brands: BrandList): string[] {
  const groups = new Map<string, { pages: number; claims: number; raw: number; kept: number }>();
  for (const r of rows) {
    const g = groups.get(r.group) ?? { pages: 0, claims: 0, raw: 0, kept: 0 };
    const { claim, mismatch } = judge(r, brands);
    g.pages++;
    if (claim) g.claims++;
    if (mismatch) {
      g.raw++;
      if (!r.allowlisted) g.kept++;
    }
    groups.set(r.group, g);
  }
  return [
    "| Group | Login pages | Claims | Mismatch (raw) | Mismatch (excl. allowlisted) | Raw rate |",
    "|---|--:|--:|--:|--:|--:|",
    ...[...groups].map(
      ([name, g]) =>
        `| ${name} | ${g.pages} | ${g.claims} | ${g.raw} | ${g.kept} | ${pct(g.raw, g.pages)} |`,
    ),
  ];
}

const cell = (s: string) => s.replace(/\|/g, "\\|").slice(0, 80);

export function renderBrandReport(
  benign: BrandRow[],
  phish: BrandRow[],
  brands: BrandList,
  meta: string[],
): string {
  const firings = benign.map((r) => ({ r, j: judge(r, brands) })).filter(({ j }) => j.mismatch);
  const misses = phish.filter((r) => !judge(r, brands).mismatch);
  const sweep: string[] = [];
  for (const cueA of [2, 3, 4]) {
    for (const minShare of [0.2, 0.3, 0.4, 0.5]) {
      const t = { ...DEFAULT_THRESHOLDS, cueA, minShare };
      const p = phish.filter((r) => judge(r, brands, t).mismatch).length;
      const fired = benign.filter((r) => judge(r, brands, t).mismatch);
      const b = fired.length;
      const kept = fired.filter((r) => !r.allowlisted).length;
      sweep.push(
        `| ${cueA} | ${minShare} | ${p} (${pct(p, phish.length)}) | ${b} (${pct(b, benign.length)}) | ${kept} |`,
      );
    }
  }
  return [
    "# Stage 2 brand–domain mismatch report (S2.6)",
    "",
    ...meta.map((m) => `- ${m}`),
    "",
    "Login pages = the crawl found the page gated (secret field) or at an identifier step. Shadow mode only: a mismatch is an anchor signal, not a warning.",
    "",
    "## Benign login pages",
    "",
    ...groupTable(benign, brands),
    "",
    "## Phish login pages",
    "",
    ...groupTable(phish, brands),
    "",
    `## Benign firings (${firings.length})`,
    "",
    "| Group | Host | Brand | Cues | Allowlisted | Title |",
    "|---|---|---|---|---|---|",
    ...firings.map(
      ({ r, j }) =>
        `| ${r.group} | ${r.host} | ${j.claim?.brand} | ${j.claim?.cues.join(", ")} | ${r.allowlisted ? "yes" : "no"} | ${cell(r.title)} |`,
    ),
    "",
    `## Phish misses (${misses.length})`,
    "",
    "| Group | Host | Title |",
    "|---|---|---|",
    ...misses.map((r) => `| ${r.group} | ${r.host} | ${cell(r.title)} |`),
    "",
    "## Threshold sweep",
    "",
    "| Cue A threshold | Cue B min share | Phish mismatches | Benign mismatches (raw) | Benign excl. allowlisted |",
    "|--:|--:|--:|--:|--:|",
    ...sweep,
    "",
  ].join("\n");
}

/**
 * One inert window per page (scripts and subresources never load), closed right after the
 * page is extracted: a single shared window keeps every parsed document alive. `<link>`
 * tags are stripped first: happy-dom preloads `rel=preload` targets, which would fetch from
 * the phish site, and the brand detector never reads them. `body.innerText` is blanked so
 * the extractor falls back to `textContent`: happy-dom's innerText can spin forever on some
 * pages, and the page text isn't a brand cue.
 */
function parseSavedPage(html: string, url: string): { doc: Document; close: () => Promise<void> } {
  const inert = html.replace(/<link\b[^>]*>/gi, "");
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  const doc = new window.DOMParser().parseFromString(inert, "text/html") as unknown as Document;
  Object.defineProperty(doc, "URL", { value: url });
  Object.defineProperty(doc, "location", { value: new URL(url) });
  if (doc.body) Object.defineProperty(doc.body, "innerText", { get: () => "" });
  return { doc, close: () => window.happyDOM.close() };
}

export async function rowsFor(
  records: CrawlRecord[],
  dir: string,
  allowlisted: (host: string) => boolean,
  timings: number[],
): Promise<BrandRow[]> {
  const rows: BrandRow[] = [];
  for (const r of records) {
    if (!r.ok || !r.snapshot || classifyInterception(r)) continue;
    const identifier = !r.gated && (r.snapshot.identifierFields ?? 0) > 0;
    if (!r.gated && !identifier) continue;
    const file = path.join(dir, r.id, "page.html");
    if (!existsSync(file)) continue;
    const url = r.final_url ?? r.url;
    const host = new URL(url).hostname;
    const page = parseSavedPage(readFileSync(file, "utf8"), url);
    const snap = extractBrandInput(page.doc);
    await page.close();
    const started = performance.now();
    detectBrandClaim(snap, bundledBrands as BrandList);
    timings.push(performance.now() - started);
    // Only the fields the detector reads; the page text isn't kept.
    const { title, headings, buttons, logoCandidates, forms, refHosts } = snap;
    rows.push({
      group: r.group,
      label: r.label,
      host,
      title,
      kind: r.gated ? "gate" : "identifier",
      input: { title, headings, buttons, logoCandidates, forms, refHosts },
      allowlisted: allowlisted(host),
    });
  }
  return rows;
}

if (import.meta.main) {
  const ROOT = path.resolve(import.meta.dirname, "../..");
  const { values } = parseArgs({
    options: {
      benign: { type: "string", default: path.join(ROOT, "corpora", "crawl-benign") },
      phish: { type: "string", default: path.join(ROOT, "corpora", "docker", "crawl") },
      index: { type: "string" },
      allowlist: { type: "string", default: path.join(ROOT, "corpora", "tranco-Y83KG-100000.txt") },
      out: { type: "string", default: path.join(ROOT, "reports", "STAGE2_BRAND.md") },
    },
  });
  if (!bundledBrands) throw new Error("brands.json is invalid");
  const allowlist = parseAllowlist(readFileSync(values.allowlist, "utf8"), bundledSharedHosts);
  const keep = values.index
    ? new Set(
        readFileSync(values.index, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => (JSON.parse(l) as { id: string }).id),
      )
    : null;
  const timings: number[] = [];
  const allows = (h: string) => allowlist.allows(h);
  const benign = await rowsFor(loadRecords(values.benign), values.benign, allows, timings);
  const phishRecords = loadRecords(values.phish).filter((r) => !keep || keep.has(r.id));
  const phish = await rowsFor(phishRecords, values.phish, allows, timings);
  const avg = timings.reduce((s, x) => s + x, 0) / (timings.length || 1);
  const md = renderBrandReport(benign, phish, bundledBrands, [
    `Generated ${new Date().toISOString()}`,
    `Benign login pages: ${benign.length} (corpora/crawl-benign)`,
    `Phish login pages: ${phish.length} (corpora/docker/crawl${keep ? ", filtered by --index" : ""})`,
    `Brands: ${bundledBrands.brands.length}; detector time: ${avg.toFixed(2)} ms/page average`,
  ]);
  await writeFile(values.out, md);
  console.log(`wrote ${values.out}`);
}
