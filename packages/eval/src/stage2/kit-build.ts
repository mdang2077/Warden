/**
 * S2.9 kit list: page skeletons (packages/shared/src/page/skeleton.ts) that recur on several
 * phishing sites and never on a benign page. Built from the **tune** split only (splitFor),
 * so the harness measures the signal on holdout sites it never saw.
 *
 *   node packages/eval/src/stage2/kit-build.ts [--benign DIR] [--phish DIR] [--min-sites 2]
 *     [--out packages/shared/src/stage2/kit-fingerprints.json]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pageFingerprint } from "@warden/shared/page/skeleton";
import { registrableDomain } from "@warden/shared/psl";
import type { KitFile } from "@warden/shared/stage2/kits";
import type { CrawlRecord } from "../crawl/crawler.ts";
import { classifyInterception } from "../crawl/interception.ts";
import { splitFor } from "./feature-row.ts";
import { loadRecords } from "./gate-report.ts";
import { parseSavedPage } from "./saved-page.ts";

const EVAL = path.resolve(import.meta.dirname, "../..");
const ROOT = path.resolve(EVAL, "../..");

export interface PageFingerprint {
  site: string;
  split: "tune" | "holdout";
  gated: boolean;
  hash: string;
}

export async function fingerprintCorpus(dir: string): Promise<PageFingerprint[]> {
  const out: PageFingerprint[] = [];
  for (const r of loadRecords(dir) as CrawlRecord[]) {
    if (!r.ok || !r.snapshot || classifyInterception(r)) continue;
    const file = path.join(dir, r.id, "page.html");
    if (!existsSync(file)) continue;
    const raw = r.final_url ?? r.url;
    let hash: string | null = null;
    try {
      const page = parseSavedPage(readFileSync(file, "utf8"), raw);
      hash = await pageFingerprint(page.doc);
      await page.close();
    } catch {
      continue;
    }
    if (!hash) continue;
    const host = new URL(raw).hostname;
    out.push({
      site: registrableDomain(host) ?? host,
      split: splitFor(host),
      gated: !!r.gated,
      hash,
    });
  }
  return out;
}

/** Skeletons on at least `minSites` distinct tune phish sites and on no tune benign page. */
export function buildKits(
  phish: readonly PageFingerprint[],
  benign: readonly PageFingerprint[],
  minSites: number,
): string[] {
  const sites = new Map<string, Set<string>>();
  for (const p of phish) {
    if (p.split !== "tune") continue;
    const s = sites.get(p.hash) ?? new Set<string>();
    s.add(p.site);
    sites.set(p.hash, s);
  }
  const benignHashes = new Set(benign.filter((b) => b.split === "tune").map((b) => b.hash));
  return [...sites]
    .filter(([hash, s]) => s.size >= minSites && !benignHashes.has(hash))
    .map(([hash]) => hash)
    .sort();
}

async function main() {
  const { values } = parseArgs({
    options: {
      benign: { type: "string", default: path.join(EVAL, "corpora", "crawl-benign") },
      phish: { type: "string", default: path.join(EVAL, "corpora", "docker", "crawl") },
      "min-sites": { type: "string", default: "2" },
      out: {
        type: "string",
        default: path.join(ROOT, "packages/shared/src/stage2/kit-fingerprints.json"),
      },
    },
  });
  const minSites = Number(values["min-sites"]);
  const phish = await fingerprintCorpus(values.phish);
  const benign = await fingerprintCorpus(values.benign);
  const kits = buildKits(phish, benign, minSites);
  const file: KitFile = { version: 1, minSites, kits };
  writeFileSync(values.out, `${JSON.stringify(file, null, 2)}\n`);

  const set = new Set(kits);
  const rate = (rows: PageFingerprint[]) =>
    `${rows.filter((r) => set.has(r.hash)).length} of ${rows.length}`;
  for (const split of ["tune", "holdout"] as const) {
    const p = phish.filter((r) => r.split === split);
    const b = benign.filter((r) => r.split === split);
    console.log(
      `[kits] ${split}: phish ${rate(p)} pages (gated ${rate(p.filter((r) => r.gated))}), benign ${rate(b)} (gated ${rate(b.filter((r) => r.gated))})`,
    );
  }
  console.log(`[kits] wrote ${kits.length} kits to ${values.out}`);
}

if (import.meta.main) await main();
