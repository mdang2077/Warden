/**
 * S2.11 score report and CI gate over the committed features file. The gate measures the
 * raw benign warn rate (allowlist exemption off): the benign crawl is Tranco-sampled, so
 * honouring the exemption would pass by construction.
 */
import { score, WARN_THRESHOLD } from "@warden/shared/stage2/score";
import { type FeatureRow, type FeaturesHeader, scoreInput } from "./features.ts";

export const BENIGN_WARN_BUDGET = 0.001;
export const SWEEP: readonly number[] = [6, 7, 8, 9, 10];
const URL_KEYS = [
  "lookalike",
  "brandKeyword",
  "ipHost",
  "tenantPlatform",
  "deepSubdomain",
] as const;

const raw = (r: FeatureRow, threshold = WARN_THRESHOLD) => score(scoreInput(r, true), threshold);
const pct = (n: number, d: number) => `${n} of ${d} (${d ? ((100 * n) / d).toFixed(2) : "0.00"}%)`;

function signalNames(r: FeatureRow): string[] {
  return score(scoreInput(r, true)).contributions.map((c) => c.signal);
}

export function gateFailures(
  rows: readonly FeatureRow[],
  header: FeaturesHeader,
  currentHash: string,
  budget = BENIGN_WARN_BUDGET,
): string[] {
  const failures: string[] = [];
  if (header.sourceHash !== currentHash) {
    failures.push(
      "signal code changed since the features were extracted: rerun `harness.ts extract`",
    );
  }
  const gated = rows.filter((r) => r.label === "benign" && r.gated);
  if (gated.length === 0) return [...failures, "no benign gated pages in the features file"];
  const warns = gated.filter((r) => raw(r).rawDecision === "warn_candidate").length;
  if (warns / gated.length > budget) {
    failures.push(
      `benign warn candidates ${pct(warns, gated.length)} exceed the ${(budget * 100).toFixed(1)}% budget`,
    );
  }
  return failures;
}

export function renderScoreReport(rows: readonly FeatureRow[], header: FeaturesHeader): string {
  const groups = new Map<string, FeatureRow[]>();
  for (const r of rows) {
    const key = `${r.label} | ${r.group} | ${r.split}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const truth = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, g]) => {
      const scored = g.map((r) => ({ gated: r.gated, ...score(scoreInput(r)) }));
      const n = (d: (s: (typeof scored)[number]) => boolean) => scored.filter(d).length;
      return `| ${key} | ${g.length} | ${n((s) => s.gated)} | ${n((s) => s.rawDecision === "suspicious")} | ${n((s) => s.rawDecision === "warn_candidate")} | ${n((s) => s.decision === "warn_candidate")} |`;
    });

  const gatedOf = (label: FeatureRow["label"]) => rows.filter((r) => r.label === label && r.gated);
  const benign = gatedOf("benign");
  const phish = gatedOf("phish");
  const sweep = SWEEP.map((t) => {
    const w = (rs: FeatureRow[]) =>
      rs.filter((r) => raw(r, t).rawDecision === "warn_candidate").length;
    return `| ${t} | ${pct(w(benign), benign.length)} | ${pct(w(phish), phish.length)} |`;
  });

  const fires = (rs: FeatureRow[], name: string) =>
    rs.filter((r) => signalNames(r).includes(name)).length;
  const names = [
    "brandMismatch:1cue",
    "brandMismatch:2cues",
    "exfil:telegram",
    "exfil:discord",
    "exfil:formService",
    "exfil:crossSiteForm",
    "ipLookup",
    ...URL_KEYS,
  ];
  const signals = names.map((s) => `| ${s} | ${fires(benign, s)} | ${fires(phish, s)} |`);

  const combos = new Map<string, number>();
  for (const r of [...benign, ...phish]) {
    const res = raw(r);
    if (res.rawDecision !== "warn_candidate") continue;
    const key = `${r.label}: ${res.contributions
      .filter((c) => c.counted)
      .map((c) => c.signal)
      .join(" + ")}`;
    combos.set(key, (combos.get(key) ?? 0) + 1);
  }
  const benignWarns = benign.filter((r) => raw(r).rawDecision === "warn_candidate");

  return [
    "# Stage 2 score report (S2.11)",
    "",
    `- Features generated ${header.generated} (source ${header.sourceHash.slice(0, 12)})`,
    `- Rows: ${header.counts.benign} benign, ${header.counts.phish} phish, ${header.counts.skipped} skipped`,
    `- Threshold ${WARN_THRESHOLD}; CI budget: raw benign warn rate on gated pages ≤ ${(BENIGN_WARN_BUDGET * 100).toFixed(1)}%`,
    "",
    "_Raw_ = allowlist exemption off (what CI gates). _Eligible_ = as the extension would decide. Identifier-only steps are scored but never warn. Shadow mode only.",
    "",
    "## Truth table",
    "",
    "| Label | Group | Split | Login pages | Gated | Suspicious | Warn (raw) | Warn (eligible) |",
    "|---|---|---|--:|--:|--:|--:|--:|",
    ...truth,
    "",
    "## Threshold sweep (gated pages, raw)",
    "",
    "| Threshold | Benign warn | Phish warn |",
    "|--:|--:|--:|",
    ...sweep,
    "",
    "## Signal fire counts (gated pages)",
    "",
    "| Signal | Benign | Phish |",
    "|---|--:|--:|",
    ...signals,
    "",
    "## Warn-candidate combinations (raw)",
    "",
    "| Label: counted signals | Pages |",
    "|---|--:|",
    ...[...combos].sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
    "",
    `## Benign warn candidates (raw): ${benignWarns.length}`,
    "",
    "Hosts are printed by `harness.ts extract` locally and never committed.",
    "",
    "| Group | Split | Counted signals |",
    "|---|---|---|",
    ...benignWarns.map(
      (r) =>
        `| ${r.group} | ${r.split} | ${raw(r)
          .contributions.filter((c) => c.counted)
          .map((c) => c.signal)
          .join(" + ")} |`,
    ),
    "",
  ].join("\n");
}
