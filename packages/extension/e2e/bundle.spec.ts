/**
 * Remote-code audit (T4b.8): the built extension must not evaluate strings as code or load
 * scripts from the network. The Chrome Web Store rejects MV3 extensions that do, and Warden
 * fetches feeds and config as JSON data only. Runs on the e2e build, which CI builds anyway.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_MANIFEST_PUBLIC_KEY } from "./manifest-test-key.ts";

const BUILD = path.resolve(import.meta.dirname, "../.output/chrome-mv3-e2e");

const FORBIDDEN: [string, RegExp][] = [
  ["eval()", /(?<![\w$.])eval\s*\(/],
  ["new Function()", /\bnew\s+Function\s*\(/],
  ["string timer", /\bset(?:Timeout|Interval)\s*\(\s*["'`]/],
  ["importScripts()", /\bimportScripts\s*\(/],
  ["remote <script>", /<script[^>]+src\s*=\s*["']?(?:https?:)?\/\//i],
  ["remote import()", /\bimport\s*\(\s*["'`](?:https?:)?\/\//],
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(js|mjs|html)$/.test(e.name) ? [p] : [];
  });
}

function findRemoteCode(dir: string): string[] {
  const found: string[] = [];
  for (const file of files(dir)) {
    const text = readFileSync(file, "utf8");
    for (const [name, re] of FORBIDDEN) {
      if (re.test(text)) found.push(`${path.relative(dir, file)}: ${name}`);
    }
  }
  return found;
}

test("the built extension has no eval, Function constructor, or remote scripts", () => {
  expect(files(BUILD).length).toBeGreaterThan(0);
  expect(findRemoteCode(BUILD)).toEqual([]);
});

test("the manifest doesn't loosen the default content security policy", () => {
  const manifest = JSON.parse(readFileSync(path.join(BUILD, "manifest.json"), "utf8"));
  expect(JSON.stringify(manifest.content_security_policy ?? {})).not.toMatch(
    /unsafe-eval|unsafe-inline|https?:/,
  );
});

test("a production build doesn't trust the e2e manifest test key", () => {
  const prod = path.resolve(import.meta.dirname, "../.output/chrome-mv3");
  test.skip(!existsSync(prod), "no production build here (CI builds e2e only)");
  const leaked = files(prod).filter((f) =>
    readFileSync(f, "utf8").includes(E2E_MANIFEST_PUBLIC_KEY),
  );
  expect(leaked).toEqual([]);
  // ...while the e2e build does (otherwise the e2e sync tests prove nothing).
  expect(files(BUILD).some((f) => readFileSync(f, "utf8").includes(E2E_MANIFEST_PUBLIC_KEY))).toBe(
    true,
  );
});
