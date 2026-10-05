/**
 * Stage 2 credential-gate report (S2.5): how often the gate fires on crawled benign pages
 * (every firing is a page Stage 2 analyzes, i.e. FP surface) and on crawled phish (pages the
 * gate misses can never be warned on). Also counts identifier-only steps, to size the
 * two-step login pattern.
 *
 *   node eval/src/stage2/gate-report.ts [--benign eval/corpora/crawl-benign]
 *     [--phish eval/corpora/docker/crawl] [--out eval/reports/STAGE2_GATE.md]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { SecretKind } from "@warden/shared/page/extract";
import type { CrawlRecord } from "../crawl/crawler.ts";
import { classifyInterception, isTlsReset } from "../crawl/interception.ts";

const KINDS: SecretKind[] = ["password", "otp", "card", "seed"];

export interface GroupStats {
  crawled: number;
  /** Loaded and not intercepted: the page itself was seen. */
  ok: number;
  /** Loaded, but an ISP filter or the site's provider replaced the page. */
  intercepted: number;
  /** Failed with a cut-off TLS handshake (typical of server-name filtering). */
  tlsReset: number;
  gated: number;
  identifierOnly: number;
  kinds: Record<SecretKind, number>;
}

export function loadRecords(dir: string): CrawlRecord[] {
  if (!existsSync(dir)) return [];
  const out: CrawlRecord[] = [];
  for (const id of readdirSync(dir)) {
    const file = path.join(dir, id, "record.json");
    if (existsSync(file)) out.push(JSON.parse(readFileSync(file, "utf8")) as CrawlRecord);
  }
  return out;
}

function emptyStats(): GroupStats {
  return {
    crawled: 0,
    ok: 0,
    intercepted: 0,
    tlsReset: 0,
    gated: 0,
    identifierOnly: 0,
    kinds: { password: 0, otp: 0, card: 0, seed: 0 },
  };
}

export function groupStats(records: readonly CrawlRecord[]): Map<string, GroupStats> {
  const groups = new Map<string, GroupStats>();
  for (const r of records) {
    const g = groups.get(r.group) ?? emptyStats();
    g.crawled++;
    if (isTlsReset(r)) g.tlsReset++;
    if (r.ok && r.snapshot && classifyInterception(r)) g.intercepted++;
    else if (r.ok && r.snapshot) {
      g.ok++;
      if (r.gated) g.gated++;
      if (!r.gated && (r.snapshot.identifierFields ?? 0) > 0) g.identifierOnly++;
      for (const k of KINDS) if (r.snapshot.secrets[k] > 0) g.kinds[k]++;
    }
    groups.set(r.group, g);
  }
  return groups;
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "–");

function table(title: string, groups: Map<string, GroupStats>, note: string): string[] {
  const rows = [...groups].sort((a, b) => b[1].ok - a[1].ok);
  const total = rows.reduce<GroupStats>((t, [, g]) => {
    t.crawled += g.crawled;
    t.ok += g.ok;
    t.intercepted += g.intercepted;
    t.tlsReset += g.tlsReset;
    t.gated += g.gated;
    t.identifierOnly += g.identifierOnly;
    for (const k of KINDS) t.kinds[k] += g.kinds[k];
    return t;
  }, emptyStats());
  const line = (name: string, g: GroupStats) =>
    `| ${name} | ${g.crawled} | ${g.intercepted} | ${g.tlsReset} | ${g.ok} | ${g.gated} | ${pct(g.gated, g.ok)} | ${pct(g.identifierOnly, g.ok)} | ${KINDS.map((k) => g.kinds[k]).join(" / ")} |`;
  return [
    `## ${title}`,
    "",
    note,
    "",
    "| Group | Crawled | Intercepted | TLS reset | Page seen | Gated | Gate rate | Identifier-only | Password / OTP / card / seed |",
    "|---|--:|--:|--:|--:|--:|--:|--:|---|",
    ...rows.map(([name, g]) => line(name, g)),
    line("**all**", total),
    "",
  ];
}

export function renderGateReport(
  benign: CrawlRecord[],
  phish: CrawlRecord[],
  meta: string[],
): string {
  return [
    "# Stage 2 credential-gate report",
    "",
    ...meta.map((m) => `- ${m}`),
    "",
    ...table(
      "Benign pages",
      groupStats(benign),
      "Every gated benign page is one Stage 2 analyzes, so the gate rate is Stage 2's FP surface. Identifier-only pages show a username/email step with no secret field (the first step of a two-step login).",
    ),
    ...table(
      "Phish pages",
      groupStats(phish),
      "Gate rate on seen phish is the ceiling on Stage 2 recall: a page the gate misses can never get a warning. _Intercepted_ pages were replaced by an ISP filter or the site's provider (CDN/host takedown); _TLS reset_ crawls had their handshake cut off, typical of filters that block by server name. Neither says anything about the page, so both are excluded from the gate rate.",
    ),
  ].join("\n");
}

if (import.meta.main) {
  const ROOT = path.resolve(import.meta.dirname, "../..");
  const { values } = parseArgs({
    options: {
      benign: { type: "string", default: path.join(ROOT, "corpora", "crawl-benign") },
      phish: { type: "string", default: path.join(ROOT, "corpora", "docker", "crawl") },
      out: { type: "string", default: path.join(ROOT, "reports", "STAGE2_GATE.md") },
    },
  });
  const benign = loadRecords(values.benign);
  const phish = loadRecords(values.phish);
  const md = renderGateReport(benign, phish, [
    `Generated ${new Date().toISOString()}`,
    `Benign records: ${benign.length} (${path.relative(ROOT, values.benign)})`,
    `Phish records: ${phish.length} (${path.relative(ROOT, values.phish)})`,
  ]);
  await writeFile(values.out, md);
  console.log(md);
}
