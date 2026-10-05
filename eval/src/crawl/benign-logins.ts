/**
 * Builds the benign login corpus (S2.4): for Tranco domains, crawl the homepage, follow up to
 * two same-site "sign in" links, and keep what loads. Pages with a secret-entry surface are
 * the corpus Stage 2's FP rate is measured on. Also crawls the curated list directly.
 * Benign sites only: safe to run on the host.
 *
 *   node eval/src/crawl/benign-logins.ts [--start 0] [--domains 500] [--concurrency 4] [--no-curated]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { bundledSharedHosts } from "@warden/shared/shared-hosts";
import { parseCuratedList } from "../corpora.ts";
import { type CrawlRecord, type CrawlTarget, crawlId, createCrawler } from "./crawler.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  allowNegative: true, // --no-curated skips the curated list (e.g. for later chunks)
  options: {
    start: { type: "string", default: "0" },
    domains: { type: "string", default: "500" },
    concurrency: { type: "string", default: "4" },
    out: { type: "string", default: path.join(ROOT, "corpora", "crawl-benign") },
    curated: { type: "boolean", default: true },
  },
});

const trancoFile = readdirSync(path.join(ROOT, "corpora"))
  .filter((f) => /^tranco-.*\.txt$/.test(f))
  .sort()
  .at(-1);
if (!trancoFile) throw new Error("no cached Tranco list: run `node eval/src/cli.ts` once first");
const domains = readFileSync(path.join(ROOT, "corpora", trancoFile), "utf8")
  .split("\n")
  .filter((d) => d && !bundledSharedHosts.isListed(d))
  .slice(Number(values.start), Number(values.start) + Number(values.domains));

const crawler = await createCrawler({ outDir: values.out });
const crawled = (url: string) => existsSync(path.join(values.out, crawlId(url), "record.json"));
const read = (url: string) =>
  JSON.parse(
    readFileSync(path.join(values.out, crawlId(url), "record.json"), "utf8"),
  ) as CrawlRecord;

let gated = 0;
let pages = 0;
async function visit(target: CrawlTarget): Promise<CrawlRecord> {
  const r = crawled(target.url) ? read(target.url) : await crawler.crawl(target);
  pages++;
  if (r.gated) gated++;
  return r;
}

const jobs: (() => Promise<void>)[] = domains.map((domain) => async () => {
  const home = await visit({
    url: `https://${domain}/`,
    label: "benign",
    group: "tranco-home",
    discoverLogin: true,
  });
  for (const url of (home.login_links ?? []).slice(0, 2)) {
    await visit({ url, label: "benign", group: "tranco-login" });
  }
});
if (values.curated) {
  const curated = parseCuratedList(
    readFileSync(path.join(ROOT, "data", "benign-logins.txt"), "utf8"),
  );
  for (const c of curated)
    jobs.push(async () => void (await visit({ url: c.url, label: "benign", group: c.group })));
}

console.error(`[benign] ${domains.length} domains from ${trancoFile} (+curated) → ${values.out}`);
let done = 0;
await Promise.all(
  Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      await job();
      if (++done % 25 === 0) console.error(`[benign] ${done} jobs, ${pages} pages, ${gated} gated`);
    }
  }),
);
await crawler.close();
console.error(`[benign] done: ${pages} pages, ${gated} with a secret-entry surface`);
