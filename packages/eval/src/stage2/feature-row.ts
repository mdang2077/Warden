/**
 * S2.11 feature rows: re-runs the shipping Stage 2 signal code on one crawled login page.
 * Kept apart from features.ts so its source is part of the features file's source hash:
 * changing which pages become rows, or how a row's values are computed, forces a re-extract.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { bundledBrands } from "@warden/shared/brands";
import { canonicalize } from "@warden/shared/canonicalize";
import { extractBrandInput, extractExfilScripts } from "@warden/shared/page/extract";
import { registrableDomain } from "@warden/shared/psl";
import { bundledSharedHosts } from "@warden/shared/shared-hosts";
import { detectBrandClaim } from "@warden/shared/stage2/brand-claim";
import { brandMismatch } from "@warden/shared/stage2/brand-mismatch";
import { scanExfil } from "@warden/shared/stage2/exfil-scan";
import { exfilSignal } from "@warden/shared/stage2/exfil-signal";
import { urlSignals } from "@warden/shared/stage2/url-signals";
import type { CrawlRecord } from "../crawl/crawler.ts";
import { classifyInterception } from "../crawl/interception.ts";
import type { FeatureRow } from "./features.ts";
import { parseSavedPage } from "./saved-page.ts";

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
