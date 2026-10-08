/**
 * Node CLI: runs the pipeline once against a local directory. Use it for local runs, or
 * from a scheduled CI job that uploads the directory (e.g. to R2 or GitHub Pages).
 *
 *   node packages/service/src/runners/cli.ts [outDir]     (default: packages/service/out)
 *   ALERT_WEBHOOK_URL=… node packages/service/src/runners/cli.ts
 *   WARDEN_DEV_FEEDS=1 node packages/service/src/runners/cli.ts   (also eval-only feeds, under dev/)
 */
import path from "node:path";
import { runPipeline } from "../run.ts";
import { prefixedStore } from "../storage.ts";
import { fsStore } from "./fs-store.ts";

const outDir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../../out"));
const devFeeds = process.env.WARDEN_DEV_FEEDS === "1";
const log = await runPipeline({
  store: devFeeds ? prefixedStore(fsStore(outDir), "dev/") : fsStore(outDir),
  fetch,
  now: Date.now(),
  devFeeds,
  ...(process.env.ALERT_WEBHOOK_URL ? { alertWebhook: process.env.ALERT_WEBHOOK_URL } : {}),
});
console.log(JSON.stringify({ outDir, ...log }, null, 2));
process.exitCode = log.alerts.length ? 1 : 0;
