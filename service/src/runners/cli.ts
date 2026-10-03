/**
 * Node CLI: runs the pipeline once against a local directory. Use it for local runs, or
 * from a scheduled CI job that uploads the directory (e.g. to R2 or GitHub Pages).
 *
 *   node service/src/runners/cli.ts [outDir]     (default: service/out)
 *   ALERT_WEBHOOK_URL=… node service/src/runners/cli.ts
 */
import path from "node:path";
import { runPipeline } from "../run.ts";
import { fsStore } from "./fs-store.ts";

const outDir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../../out"));
const log = await runPipeline({
  store: fsStore(outDir),
  fetch,
  now: Date.now(),
  ...(process.env.ALERT_WEBHOOK_URL ? { alertWebhook: process.env.ALERT_WEBHOOK_URL } : {}),
});
console.log(JSON.stringify({ outDir, ...log }, null, 2));
process.exitCode = log.alerts.length ? 1 : 0;
