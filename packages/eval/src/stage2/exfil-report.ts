/**
 * Stage 2 credential-exfiltration report (S2.7): re-runs the shipping scan over the crawl's
 * saved page.html on the Stage 2 surface (pages the crawl found gated or at an identifier
 * step) and counts where credentials would go. Also counts pages that trip both anchors
 * (brand mismatch and exfil), roughly what a future warning needs.
 *
 *   node packages/eval/src/stage2/exfil-report.ts [--benign DIR] [--phish DIR] [--index FILE]
 *     [--allowlist TRANCO_TXT] [--out packages/eval/reports/STAGE2_EXFIL.md]
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseAllowlist } from "@warden/shared/allowlist";
import { bundledBrands } from "@warden/shared/brands";
import { extractBrandInput, extractExfilScripts } from "@warden/shared/page/extract";
import { bundledSharedHosts } from "@warden/shared/shared-hosts";
import { detectBrandClaim } from "@warden/shared/stage2/brand-claim";
import { brandMismatch } from "@warden/shared/stage2/brand-mismatch";
import { scanExfil } from "@warden/shared/stage2/exfil-scan";
import { type ExfilSignal, exfilSignal } from "@warden/shared/stage2/exfil-signal";
import type { CrawlRecord } from "../crawl/crawler.ts";
import { classifyInterception } from "../crawl/interception.ts";
import { loadRecords } from "./gate-report.ts";
import { parseSavedPage } from "./saved-page.ts";

export interface ExfilRow {
  group: string;
  label: string;
  host: string;
  title: string;
  signal: ExfilSignal | null;
  brandMismatch: boolean;
  allowlisted: boolean;
}

const KINDS = ["telegram", "discord", "formService", "crossSiteForm"] as const;
const cell = (s: string) => s.replace(/\|/g, "\\|").slice(0, 80);

function groupTable(rows: ExfilRow[]): string[] {
  const groups = new Map<string, ExfilRow[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  const line = (name: string, g: ExfilRow[]) => {
    const fired = g.filter((r) => r.signal?.kind);
    const byKind = KINDS.map((k) => g.filter((r) => r.signal?.kind === k).length);
    const ip = g.filter((r) => r.signal?.ip).length;
    const both = fired.filter((r) => r.brandMismatch).length;
    return `| ${name} | ${g.length} | ${fired.length} | ${byKind.join(" | ")} | ${ip} | ${both} |`;
  };
  return [
    "| Group | Login pages | Exfil | Telegram | Discord | Form service | Cross-site form | IP lookup | Brand + exfil |",
    "|---|--:|--:|--:|--:|--:|--:|--:|--:|",
    ...[...groups].map(([name, g]) => line(name, g)),
  ];
}

export function renderExfilReport(benign: ExfilRow[], phish: ExfilRow[], meta: string[]): string {
  const firings = benign.filter((r) => r.signal?.kind);
  return [
    "# Stage 2 credential-exfiltration report (S2.7)",
    "",
    ...meta.map((m) => `- ${m}`),
    "",
    "Login pages = the crawl found the page gated or at an identifier step. _Exfil_ = an anchor kind fired (IP lookup is supporting only). _Brand + exfil_ = the page also trips the S2.6 brand mismatch. Shadow mode only.",
    "",
    "## Benign login pages",
    "",
    ...groupTable(benign),
    "",
    "## Phish login pages",
    "",
    ...groupTable(phish),
    "",
    `## Benign firings (${firings.length})`,
    "",
    "| Group | Host | Kind | Allowlisted | Title |",
    "|---|---|---|---|---|",
    ...firings.map(
      (r) =>
        `| ${r.group} | ${r.host} | ${r.signal?.kind} | ${r.allowlisted ? "yes" : "no"} | ${cell(r.title)} |`,
    ),
    "",
  ].join("\n");
}

async function rowsFor(
  records: CrawlRecord[],
  dir: string,
  allowlisted: (host: string) => boolean,
): Promise<ExfilRow[]> {
  const brands = bundledBrands;
  const rows: ExfilRow[] = [];
  for (const r of records) {
    if (!r.ok || !r.snapshot || classifyInterception(r)) continue;
    const identifier = !r.gated && (r.snapshot.identifierFields ?? 0) > 0;
    if (!r.gated && !identifier) continue;
    const file = path.join(dir, r.id, "page.html");
    if (!existsSync(file)) continue;
    const url = r.final_url ?? r.url;
    const host = new URL(url).hostname;
    const page = parseSavedPage(readFileSync(file, "utf8"), url);
    const input = extractBrandInput(page.doc);
    const scripts = extractExfilScripts(page.doc);
    await page.close();
    const claim = brands ? detectBrandClaim(input, brands) : null;
    rows.push({
      group: r.group,
      label: r.label,
      host,
      title: input.title,
      signal: exfilSignal(scanExfil({ forms: input.forms, ...scripts }), host),
      brandMismatch: !!(claim && brands && brandMismatch(claim, host, brands)),
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
      out: { type: "string", default: path.join(ROOT, "reports", "STAGE2_EXFIL.md") },
    },
  });
  const allowlist = parseAllowlist(readFileSync(values.allowlist, "utf8"), bundledSharedHosts);
  const allows = (h: string) => allowlist.allows(h);
  const keep = values.index
    ? new Set(
        readFileSync(values.index, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => (JSON.parse(l) as { id: string }).id),
      )
    : null;
  const benign = await rowsFor(loadRecords(values.benign), values.benign, allows);
  const phishRecords = loadRecords(values.phish).filter((r) => !keep || keep.has(r.id));
  const phish = await rowsFor(phishRecords, values.phish, allows);
  const md = renderExfilReport(benign, phish, [
    `Generated ${new Date().toISOString()}`,
    `Benign login pages: ${benign.length} (corpora/crawl-benign)`,
    `Phish login pages: ${phish.length} (corpora/docker/crawl${keep ? ", filtered by --index" : ""})`,
  ]);
  await writeFile(values.out, md);
  console.log(`wrote ${values.out}`);
}
