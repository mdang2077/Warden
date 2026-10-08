/**
 * Bundles packages/shared/src/page/extract.ts into a self-contained script for injection into
 * crawled pages, so the crawler runs exactly the extractor the content script ships.
 */
import path from "node:path";
import { build } from "esbuild";

const ENTRY = path.resolve(import.meta.dirname, "../../../shared/src/page/extract.ts");

/** An expression that evaluates to the page's `PageSnapshot`. */
export async function extractorScript(): Promise<string> {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__wardenExtract",
    target: "es2020",
    platform: "browser",
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("extractor bundle is empty");
  return `(() => { ${code}; return __wardenExtract.extractSnapshot(document); })()`;
}
