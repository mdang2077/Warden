/**
 * Stage 1 FP baseline (Phase 4). Builds lists from feed records with the production
 * pipeline, runs the production cascade over the benign and phish corpora, and writes:
 * - SUMMARY.md: the CI gate, truth tables (flagged and block-only views), benign results
 *   per group, recall per feed and tier, an allowlist ablation, and every benign flag;
 * - TIER_B.md: per Tier B feed collisions and contribution, for promotion decisions.
 *
 * The gate: any benign `block` under the production feed config fails.
 */

import { DEFAULT_FEED_CONFIG, type FeedConfig } from "@warden/service/config";
import type { FeedRecord } from "@warden/service/feeds/types";
import { buildAllowlist, parseAllowlist, serializeAllowlist } from "@warden/shared/allowlist";
import { FEED_DISTRIBUTION } from "@warden/shared/feed-format";
import type { SharedHostList } from "@warden/shared/shared-hosts";
import { FEED_IDS, type FeedId } from "@warden/shared/types";
import { phishUrls, splitByTime, type TimeSplit } from "./corpora.ts";
import { type EvalSetup, evaluateUrls, type LabeledUrl, type UrlResult } from "./evaluate.ts";
import { buildMemoryLists, type MemoryLists } from "./lists.ts";
import { fpr, pct, precision, recall, type TruthTable, truthTable, type View } from "./truth.ts";

export interface EvalInput {
  benign: LabeledUrl[];
  phish: FeedRecord[];
  /** Ranked domains for the allowlist (the same Tranco list the service uses). */
  trancoDomains: string[];
  shared: SharedHostList;
  now: number;
  /** Free-form provenance lines for the report header. */
  meta: string[];
  log?: (msg: string) => void;
  /**
   * Which feeds count as "production" (T4b.4). `shippable` (the release gate and the default):
   * only feeds whose data may reach users (FEED_DISTRIBUTION), as the published snapshot has
   * them. `all`: every enabled feed, for research (what OpenPhish adds).
   */
  feeds?: "shippable" | "all";
}

export interface EvalOutput {
  gatePassed: boolean;
  benignBlocks: UrlResult[];
  summary: string;
  tierB: string;
  stats: Record<string, unknown>;
}

/** Every feed on, at its configured tier: used for recall and Tier B analysis. */
const ALL_FEEDS: FeedConfig = Object.fromEntries(
  FEED_IDS.map((f) => [f, { ...DEFAULT_FEED_CONFIG[f], enabled: true }]),
) as FeedConfig;

export async function runEval(input: EvalInput): Promise<EvalOutput> {
  const log = input.log ?? (() => {});
  const mode = input.feeds ?? "shippable";
  const prodConfig: FeedConfig =
    mode === "all"
      ? DEFAULT_FEED_CONFIG
      : (Object.fromEntries(
          FEED_IDS.map((f) => [
            f,
            FEED_DISTRIBUTION[f] === "shippable"
              ? DEFAULT_FEED_CONFIG[f]
              : { ...DEFAULT_FEED_CONFIG[f], enabled: false },
          ]),
        ) as FeedConfig);
  const meta = [
    ...input.meta,
    mode === "all"
      ? "Feeds: all (research: includes eval-only feeds such as OpenPhish)"
      : "Feeds: shippable (the release gate: only feeds whose data may reach users)",
  ];
  // The report reads its header from `input.meta`.
  input = { ...input, meta };
  const { shared, now } = input;
  const allowlist = parseAllowlist(
    serializeAllowlist(buildAllowlist(input.trancoDomains, shared)),
    shared,
  );
  log(`allowlist: ${allowlist.size} registrable domains`);

  const prodLists = await buildMemoryLists(input.phish, prodConfig, allowlist, shared, now);
  const allLists = await buildMemoryLists(input.phish, ALL_FEEDS, allowlist, shared, now);
  const run = (urls: LabeledUrl[], setup: EvalSetup, name: string) => {
    log(`${name}: ${urls.length} URLs`);
    return evaluateUrls(urls, setup, (n) => log(`  ${name}: ${n}`));
  };

  const benignProd = await run(
    input.benign,
    { lists: prodLists, allowlist, shared },
    "benign/prod",
  );
  const benignAll = await run(input.benign, { lists: allLists, allowlist, shared }, "benign/all");
  const benignNoAllow = await run(
    input.benign,
    { lists: prodLists, allowlist: null, shared },
    "benign/no-allowlist",
  );

  // Recall on held-out phish: lists from older records, tested on newer ones.
  const split = splitByTime(input.phish);
  const train = split ? split.train : input.phish;
  const test = phishUrls(split ? split.test : input.phish);
  const trainProd = split
    ? await buildMemoryLists(train, prodConfig, allowlist, shared, now)
    : prodLists;
  const trainAll = split
    ? await buildMemoryLists(train, ALL_FEEDS, allowlist, shared, now)
    : allLists;
  const phishProd = await run(test, { lists: trainProd, allowlist, shared }, "phish/prod");
  const phishAll = await run(test, { lists: trainAll, allowlist, shared }, "phish/all");

  const benignBlocks = benignProd.filter((r) => r.decision === "block");
  const gatePassed = benignBlocks.length === 0;

  const summary = renderSummary({
    input,
    allowlistSize: allowlist.size,
    split,
    prodLists,
    benignProd,
    benignAll,
    benignNoAllow,
    phishProd,
    phishAll,
    gatePassed,
  });
  const tierB = renderTierB({ input, allLists, benignAll, phishAll, split });

  return {
    gatePassed,
    benignBlocks,
    summary,
    tierB,
    stats: {
      gatePassed,
      benign: input.benign.length,
      phishTest: test.length,
      timeSplit: split ? { cutoff: split.cutoff, train: split.train.length } : null,
      prod: {
        block: truthTable([...benignProd, ...phishProd], "block"),
        flagged: truthTable([...benignProd, ...phishProd], "flagged"),
      },
      benignBlocks: benignBlocks.map((r) => r.url),
      benignFlaggedAllFeeds: benignAll.filter((r) => r.decision !== "allow").map((r) => r.url),
    },
  };
}

interface SummaryParts {
  input: EvalInput;
  allowlistSize: number;
  split: TimeSplit | null;
  prodLists: MemoryLists;
  benignProd: UrlResult[];
  benignAll: UrlResult[];
  benignNoAllow: UrlResult[];
  phishProd: UrlResult[];
  phishAll: UrlResult[];
  gatePassed: boolean;
}

function renderSummary(p: SummaryParts): string {
  const lines: string[] = [];
  const out = (...l: string[]) => lines.push(...l);
  const benignBlocks = p.benignProd.filter((r) => r.decision === "block");

  out("# Warden Stage 1 FP baseline", "");
  out(...p.input.meta.map((m) => `- ${m}`));
  out(`- Allowlist: ${p.allowlistSize} registrable domains (Tranco minus shared hosts)`);
  out(
    `- Phish split: ${
      p.split
        ? `held out by time; lists from ${p.split.train.length} records first seen before ${new Date(p.split.cutoff).toISOString()}, tested on ${p.split.test.length} newer ones`
        : "no time split (single snapshot): recall is in-list, i.e. an upper bound"
    }`,
  );
  out("- Safe Browsing: off (offline run; measures Warden's own lists)", "");
  out(
    "**Reading this report.** Most benign URLs are on allowlisted domains, so they can't be blocked by construction; the URLs that actually test matching are the non-allowlisted ones (shared hosts, unranked login paths). The production truth tables count phish from every feed, including Tier B feeds production doesn't use, so overall recall there is low by design: see recall by feed.",
    "",
  );

  out(
    `## Gate: ${p.gatePassed ? "PASS" : "FAIL"}`,
    "",
    `Benign \`block\` decisions under the production config (OpenPhish, Tier A): **${benignBlocks.length}**. Budget: 0.`,
    "",
  );

  out("## Truth tables (production config)", "");
  for (const view of ["block", "flagged"] as View[]) {
    const t = truthTable([...p.benignProd, ...p.phishProd], view);
    out(`### ${view === "block" ? "Block-only view" : "Flagged view (escalate + block)"}`, "");
    out(...tableRows(t), "");
  }

  out("## Benign corpus by group", "");
  out(
    "| Group | URLs | Allowlisted | Escalate (prod) | Block (prod) | Flagged, all feeds | Block, no allowlist |",
    "|---|--:|--:|--:|--:|--:|--:|",
  );
  for (const group of groups(p.benignProd)) {
    const prod = p.benignProd.filter((r) => r.group === group);
    const all = p.benignAll.filter((r) => r.group === group);
    const noAllow = p.benignNoAllow.filter((r) => r.group === group);
    out(
      `| ${group} | ${prod.length} | ${count(prod, (r) => r.allowlisted)} | ${count(prod, (r) => r.decision === "escalate")} | ${count(prod, (r) => r.decision === "block")} | ${count(all, (r) => r.decision !== "allow")} | ${count(noAllow, (r) => r.decision === "block")} |`,
    );
  }
  out(
    "",
    "_All feeds_ enables Phishing.Database and PhishStats at Tier B. _No allowlist_ removes the client-side Stage 0 check (feeds are still cleaned against it server-side), showing how much the allowlist is doing.",
    "",
  );

  out("## Recall by feed", "");
  out(
    "| Feed | Tier | Test URLs | Blocked (prod) | Flagged (all feeds) | Recall, block (prod) | Recall, flagged (all) | Lost to allowlist |",
    "|---|---|--:|--:|--:|--:|--:|--:|",
  );
  for (const feed of FEED_IDS) {
    const prod = p.phishProd.filter((r) => r.group === feed);
    const all = p.phishAll.filter((r) => r.group === feed);
    if (!prod.length) {
      out(`| ${feed} | ${DEFAULT_FEED_CONFIG[feed].tier} | 0 | – | – | – | – | – |`);
      continue;
    }
    const blocked = count(prod, (r) => r.decision === "block");
    const flagged = count(all, (r) => r.decision !== "allow");
    out(
      `| ${feed} | ${DEFAULT_FEED_CONFIG[feed].tier} | ${prod.length} | ${blocked} | ${flagged} | ${pct(blocked / prod.length)} | ${pct(flagged / all.length)} | ${count(prod, (r) => r.allowlisted)} |`,
    );
  }
  out("");

  out("## Recall by tier (all feeds)", "");
  out(
    "| Tier | Test URLs | Blocked | Escalated | Recall, block | Recall, flagged |",
    "|---|--:|--:|--:|--:|--:|",
  );
  for (const tier of ["A", "B"] as const) {
    const feeds = FEED_IDS.filter((f) => DEFAULT_FEED_CONFIG[f].tier === tier);
    const rs = p.phishAll.filter((r) => feeds.includes(r.group as FeedId));
    const blocked = count(rs, (r) => r.decision === "block");
    const escalated = count(rs, (r) => r.decision === "escalate");
    out(
      `| ${tier} | ${rs.length} | ${blocked} | ${escalated} | ${pct(rs.length ? blocked / rs.length : null)} | ${pct(rs.length ? (blocked + escalated) / rs.length : null)} |`,
    );
  }
  out("");

  out("## Feed cleaning (production lists)", "");
  out(
    "| Feed | Ingested | Invalid | Allowlist drops | Shared-host drops | TTL drops | Duplicates | Kept |",
  );
  out("|---|--:|--:|--:|--:|--:|--:|--:|");
  for (const [feed, s] of Object.entries(p.prodLists.stats)) {
    out(
      `| ${feed} | ${s.ingested} | ${s.invalid} | ${s.dropped_allowlist} | ${s.dropped_shared_host} | ${s.dropped_ttl} | ${s.duplicates} | ${s.kept} |`,
    );
  }
  out("");

  out("## Benign blocks (production)", "");
  out(...(benignBlocks.length ? benignBlocks.map(describe) : ["None."]), "");
  const benignEscalations = p.benignProd.filter((r) => r.decision === "escalate");
  out("## Benign escalations (production, first 50)", "");
  out(...(benignEscalations.length ? benignEscalations.slice(0, 50).map(describe) : ["None."]), "");
  const allFlags = p.benignAll.filter((r) => r.decision !== "allow");
  out("## Benign flags with all feeds enabled (first 50)", "");
  out(...(allFlags.length ? allFlags.slice(0, 50).map(describe) : ["None."]), "");
  const noAllowBlocks = p.benignNoAllow.filter((r) => r.decision === "block");
  out("## Benign blocks without the client allowlist (first 50)", "");
  out(...(noAllowBlocks.length ? noAllowBlocks.slice(0, 50).map(describe) : ["None."]), "");

  return `${lines.join("\n")}\n`;
}

interface TierBParts {
  input: EvalInput;
  allLists: MemoryLists;
  benignAll: UrlResult[];
  phishAll: UrlResult[];
  split: TimeSplit | null;
}

function renderTierB(p: TierBParts): string {
  const lines: string[] = ["# Tier B promotion report", ""];
  lines.push(...p.input.meta.map((m) => `- ${m}`), "");
  lines.push(
    "A Tier B feed is promoted to Tier A only after a clean Phase 4 run **and** 2 weeks of shadow logs with no allowlist collisions (docs/fp-policy.md §4). This report covers the Phase 4 part.",
    "",
    "| Feed | Records | Kept | Allowlist collisions | Collision rate | Benign URLs matched | Phish test URLs matched | Caught only by this feed | Phase 4 clean? |",
    "|---|--:|--:|--:|--:|--:|--:|--:|---|",
  );
  const tierA = FEED_IDS.filter((f) => DEFAULT_FEED_CONFIG[f].tier === "A");
  const samples: string[] = [];
  for (const feed of FEED_IDS.filter((f) => DEFAULT_FEED_CONFIG[f].tier === "B")) {
    const s = p.allLists.stats[feed];
    if (!s || s.ingested === 0) {
      lines.push(`| ${feed} | 0 | – | – | – | – | – | – | no data |`);
      continue;
    }
    const benignHits = p.benignAll.filter((r) => r.feeds.includes(feed));
    const phishHits = p.phishAll.filter((r) => r.feeds.includes(feed));
    const unique = phishHits.filter((r) => !r.feeds.some((f) => tierA.includes(f)));
    const clean = benignHits.length === 0 && s.dropped_allowlist === 0;
    lines.push(
      `| ${feed} | ${s.ingested} | ${s.kept} | ${s.dropped_allowlist} | ${pct(s.dropped_allowlist / s.ingested)} | ${benignHits.length} | ${phishHits.length} | ${unique.length} | ${clean ? "yes" : "no"} |`,
    );
    if (s.allowlist_samples.length) {
      samples.push(
        `### ${feed}: allowlist collision samples`,
        "",
        ...s.allowlist_samples.map((u) => `- \`${u}\``),
        "",
      );
    }
    if (benignHits.length) {
      samples.push(
        `### ${feed}: benign URLs matched`,
        "",
        ...benignHits.slice(0, 50).map(describe),
        "",
      );
    }
  }
  lines.push(
    "",
    "_Allowlist collisions_ are feed entries on Tranco-ranked domains, dropped during cleaning: each one would have been a false positive. _Benign URLs matched_ counts benign corpus URLs that still matched after cleaning.",
    "",
    ...samples,
  );
  return `${lines.join("\n")}\n`;
}

function tableRows(t: TruthTable): string[] {
  return [
    "| | Flagged | Not flagged |",
    "|---|--:|--:|",
    `| **Phish** | TP ${t.tp} | FN ${t.fn} |`,
    `| **Benign** | FP ${t.fp} | TN ${t.tn} |`,
    "",
    `Precision ${pct(precision(t))} · Recall ${pct(recall(t))} · FPR ${pct(fpr(t), 4)}`,
  ];
}

function groups(results: readonly UrlResult[]): string[] {
  return [...new Set(results.map((r) => r.group))];
}

function count(results: readonly UrlResult[], pred: (r: UrlResult) => boolean): number {
  return results.reduce((n, r) => n + (pred(r) ? 1 : 0), 0);
}

function describe(r: UrlResult): string {
  return `- \`${r.url}\` (${r.group}): ${r.decision}${r.feeds.length ? ` via ${r.feeds.join(", ")}` : ""}`;
}
