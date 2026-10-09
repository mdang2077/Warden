/**
 * Stage 1 FP baseline CLI.
 *
 *   node packages/eval/src/cli.ts [--top 100000] [--state <pipeline out dir>] [--phish-file <json>]
 *                        [--max-phish 5000] [--out packages/eval/reports] [--cache packages/eval/corpora]
 *                        [--feeds shippable|all]
 *
 * --feeds shippable (default, the release gate): only feeds whose data may reach users.
 * --feeds all: every enabled feed, including eval-only ones like OpenPhish (research).
 *
 * Writes SUMMARY.md, TIER_B.md, and runs/<timestamp>.json to --out. Exits 1 when the gate
 * fails (any benign block under the production config), so CI can use it directly.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { FeedRecord } from "@warden/service/feeds/types";
import { bundledSharedHosts, bundledSharedHostsFile } from "@warden/shared/shared-hosts";
import {
  fetchPhishLive,
  fetchTranco,
  loadCuratedBenign,
  loadPhishFromState,
  trancoBenign,
} from "./corpora.ts";
import { runEval } from "./run.ts";
import { sampleByFeed } from "./sample.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    top: { type: "string", default: "100000" },
    feeds: { type: "string", default: "shippable" },
    state: { type: "string" },
    "phish-file": { type: "string" },
    "max-phish": { type: "string", default: "5000" },
    out: { type: "string", default: path.join(ROOT, "reports") },
    cache: { type: "string", default: path.join(ROOT, "corpora") },
  },
});

const now = Date.now();
const log = (msg: string) => console.error(`[eval] ${msg}`);
await mkdir(values.cache, { recursive: true });

// Tranco: the same list feeds the allowlist and the benign homepages.
const topN = Number(values.top);
const tranco = await fetchTranco(fetch, topN);
await writeFile(
  path.join(values.cache, `tranco-${tranco.id}-${topN}.txt`),
  tranco.domains.join("\n"),
);
log(`tranco ${tranco.id}: ${tranco.domains.length} domains`);

let phish: FeedRecord[];
let phishSource: string;
const feedErrors: string[] = [];
if (values.state) {
  phish = await loadPhishFromState(values.state);
  phishSource = `pipeline state in ${values.state}`;
} else if (values["phish-file"]) {
  phish = JSON.parse(await readFile(values["phish-file"], "utf8")) as FeedRecord[];
  phishSource = values["phish-file"];
} else {
  const live = await fetchPhishLive(fetch, now);
  phish = live.records;
  for (const [feed, err] of Object.entries(live.errors)) feedErrors.push(`${feed}: ${err}`);
  const file = path.join(values.cache, `phish-${new Date(now).toISOString().slice(0, 10)}.json`);
  await writeFile(file, JSON.stringify(phish));
  phishSource = `live fetch (saved to ${path.relative(ROOT, file)})`;
}
phish = sampleByFeed(phish, Number(values["max-phish"]), 1);
log(`phish: ${phish.length} records from ${phishSource}`);

const curatedFile = path.join(ROOT, "data", "benign-logins.txt");
const benign = [
  ...trancoBenign(tranco.domains),
  ...(existsSync(curatedFile) ? await loadCuratedBenign(curatedFile) : []),
];

const perFeed = Object.entries(
  phish.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + 1;
    return acc;
  }, {}),
)
  .map(([f, n]) => `${f} ${n}`)
  .join(", ");

if (values.feeds !== "shippable" && values.feeds !== "all") {
  throw new Error(`--feeds must be "shippable" or "all", not ${values.feeds}`);
}
const result = await runEval({
  feeds: values.feeds,
  benign,
  phish,
  trancoDomains: tranco.domains,
  shared: bundledSharedHosts,
  now,
  log,
  meta: [
    `Run: ${new Date(now).toISOString()}`,
    `Tranco list ${tranco.id}, top ${topN}`,
    `Benign URLs: ${benign.length}`,
    `Phish records: ${phish.length} (${perFeed || "none"}) from ${phishSource}`,
    ...(feedErrors.length ? [`Feed errors: ${feedErrors.join("; ")}`] : []),
    `Shared-host list v${bundledSharedHostsFile.version}`,
  ],
});

await mkdir(path.join(values.out, "runs"), { recursive: true });
await writeFile(path.join(values.out, "SUMMARY.md"), result.summary);
await writeFile(path.join(values.out, "TIER_B.md"), result.tierB);
const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
await writeFile(
  path.join(values.out, "runs", `${stamp}.json`),
  `${JSON.stringify(result.stats, null, 2)}\n`,
);

log(`gate: ${result.gatePassed ? "PASS" : "FAIL"} (${result.benignBlocks.length} benign blocks)`);
for (const r of result.benignBlocks) log(`  benign block: ${r.url} via ${r.feeds.join(", ")}`);
process.exitCode = result.gatePassed ? 0 : 1;
