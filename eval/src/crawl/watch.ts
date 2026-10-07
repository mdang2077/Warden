/**
 * Phish-at-ingest watcher (S2.3), meant to run in the hardened container in docker/crawler/.
 * Every cycle it polls the feeds (persisting first_seen under <data>/feeds, which also gives
 * the eval harness real history for its time split), then crawls URLs it hasn't crawled
 * yet, newest first, because phishing pages die within hours.
 *
 *   node eval/src/crawl/watch.ts --data /data [--interval 30] [--once]
 *
 * Retry policy: a failed crawl is retried once, at least 30 minutes later. A page that
 * fails twice is recorded as dead.
 */
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { ingest } from "@warden/service/feeds/ingest";
import type { FeedRecord } from "@warden/service/feeds/types";
import { INGESTORS } from "@warden/service/run";
import { fsStore } from "@warden/service/runners/fs-store";
import { FEED_IDS } from "@warden/shared/types";
import { type CrawlRecord, type CrawlTarget, crawlId, createCrawler } from "./crawler.ts";

const RETRY_AFTER_MS = 30 * 60_000;

export interface SelectOptions {
  now: number;
  /** When the watcher first ran: earlier feed entries are backlog. */
  initializedAt: number;
  /** Backlog entries to crawl per feed on the first cycle. */
  backlogPerFeed: number;
  firstCycle: boolean;
  maxPerCycle: number;
}

export type PriorCrawl = Pick<CrawlRecord, "ok" | "attempt" | "crawled_at">;

/**
 * Which feed URLs to crawl this cycle: new ones (first seen after the watcher started),
 * a sample of the backlog on the first cycle, and one retry for failures. Newest first.
 */
export function selectTargets(
  records: readonly FeedRecord[],
  prior: (url: string) => PriorCrawl | null,
  opts: SelectOptions,
): { target: CrawlTarget; attempt: number }[] {
  const picked: { record: FeedRecord; attempt: number }[] = [];
  const backlogTaken = new Map<string, number>();
  for (const r of [...records].sort((a, b) => b.first_seen - a.first_seen)) {
    const p = prior(r.url);
    let attempt: number;
    if (!p) attempt = 1;
    else if (!p.ok && p.attempt < 2 && opts.now - p.crawled_at >= RETRY_AFTER_MS) attempt = 2;
    else continue;

    const isNew = r.first_seen > opts.initializedAt;
    if (!isNew && attempt === 1) {
      const taken = backlogTaken.get(r.source) ?? 0;
      if (!opts.firstCycle || taken >= opts.backlogPerFeed) continue;
      backlogTaken.set(r.source, taken + 1);
    }
    picked.push({ record: r, attempt });
    if (picked.length >= opts.maxPerCycle) break;
  }
  return picked.map(({ record, attempt }) => ({
    target: { url: record.url, label: "phish", group: record.source },
    attempt,
  }));
}

async function main() {
  const { values } = parseArgs({
    options: {
      data: { type: "string", default: path.resolve(import.meta.dirname, "../../corpora/docker") },
      interval: { type: "string", default: "30" },
      "max-per-cycle": { type: "string", default: "300" },
      backlog: { type: "string", default: "100" },
      concurrency: { type: "string", default: "3" },
      once: { type: "boolean", default: false },
    },
  });
  const crawlDir = path.join(values.data, "crawl");
  const feedStore = fsStore(path.join(values.data, "feeds"));
  await mkdir(crawlDir, { recursive: true });

  const stateFile = path.join(values.data, "watch-state.json");
  let state = existsSync(stateFile)
    ? (JSON.parse(await readFile(stateFile, "utf8")) as { initializedAt: number })
    : null;

  const priorCrawl = (url: string): PriorCrawl | null => {
    const file = path.join(crawlDir, crawlId(url), "record.json");
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as PriorCrawl;
    } catch {
      return null;
    }
  };

  const crawler = await createCrawler({ outDir: crawlDir });
  let firstCycle = true;
  for (;;) {
    const now = Date.now();
    // The first ingest stamps every URL first_seen = now, so initializing to the same
    // timestamp makes that whole first pull backlog (selectTargets uses a strict >).
    if (!state) {
      state = { initializedAt: now };
      await writeFile(stateFile, JSON.stringify(state));
    }
    const records: FeedRecord[] = [];
    const feedErrors: Record<string, string> = {};
    for (const feed of FEED_IDS) {
      const out = await ingest(INGESTORS[feed], feedStore, fetch, now);
      if (out.error) feedErrors[feed] = out.error;
      for (const r of out.records) records.push(r);
    }

    const targets = selectTargets(records, priorCrawl, {
      now,
      initializedAt: state.initializedAt,
      backlogPerFeed: Number(values.backlog),
      firstCycle,
      maxPerCycle: Number(values["max-per-cycle"]),
    });
    let ok = 0;
    const queue = [...targets];
    await Promise.all(
      Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          if ((await crawler.crawl(t.target, t.attempt)).ok) ok++;
        }
      }),
    );

    const summary = {
      at: now,
      feed_records: records.length,
      crawled: targets.length,
      ok,
      feedErrors,
    };
    console.log(`[watch] ${JSON.stringify(summary)}`);
    await appendFile(path.join(values.data, "watch.log"), `${JSON.stringify(summary)}\n`);
    firstCycle = false;
    if (values.once) break;
    await new Promise((r) => setTimeout(r, Number(values.interval) * 60_000));
  }
  await crawler.close();
}

if (import.meta.main) await main();
