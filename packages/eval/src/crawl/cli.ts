/**
 * Crawl a list of URLs into a Stage 2 corpus.
 *
 *   node packages/eval/src/crawl/cli.ts --input urls.txt --label benign --group logins
 *   node packages/eval/src/crawl/cli.ts --input packages/eval/corpora/phish-2026-10-03.json --label phish --limit 200
 *
 * --input is a text file (one URL per line) or a JSON array of feed records ({url, source}).
 * Already-crawled URLs (same id under --out) are skipped unless --recrawl is given.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { type CrawlTarget, crawlId, createCrawler } from "./crawler.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    input: { type: "string" },
    label: { type: "string", default: "benign" },
    group: { type: "string", default: "manual" },
    out: { type: "string", default: path.join(ROOT, "corpora", "crawl") },
    concurrency: { type: "string", default: "3" },
    limit: { type: "string" },
    recrawl: { type: "boolean", default: false },
  },
});
if (!values.input) throw new Error("--input is required");
if (values.label !== "benign" && values.label !== "phish") throw new Error("--label: benign|phish");
const label = values.label;

export function parseTargets(
  text: string,
  label: "benign" | "phish",
  group: string,
): CrawlTarget[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    return (JSON.parse(trimmed) as { url: string; source?: string }[]).map((r) => ({
      url: r.url,
      label,
      group: r.source ?? group,
    }));
  }
  return trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//.test(l))
    .map((url) => ({ url, label, group }));
}

let targets = parseTargets(await readFile(values.input, "utf8"), label, values.group);
if (!values.recrawl) {
  targets = targets.filter(
    (t) => !existsSync(path.join(values.out, crawlId(t.url), "record.json")),
  );
}
if (values.limit) targets = targets.slice(0, Number(values.limit));
console.error(`[crawl] ${targets.length} URLs → ${values.out}`);

const crawler = await createCrawler({ outDir: values.out });
let done = 0;
let ok = 0;
const queue = [...targets];
await Promise.all(
  Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const r = await crawler.crawl(t);
      done++;
      if (r.ok) ok++;
      if (done % 10 === 0 || done === targets.length) {
        console.error(`[crawl] ${done}/${targets.length} (${ok} ok)`);
      }
    }
  }),
);
await crawler.close();
