/**
 * Known phishing-kit page skeletons (S2.9), built by packages/eval/src/stage2/kit-build.ts:
 * skeleton hashes (page/skeleton.ts) seen on several phishing sites and never on a benign
 * page. A match says the page is a copy of a kit already seen in the wild.
 */
import bundled from "./kit-fingerprints.json" with { type: "json" };

export interface KitFile {
  version: number;
  /** Distinct phishing sites a skeleton needed to count as a kit. */
  minSites: number;
  kits: string[];
}

const HASH = /^[0-9a-f]{16}$/;

export function loadKits(file: KitFile): ReadonlySet<string> {
  if (!Number.isInteger(file.version) || file.version < 1) {
    throw new Error(`kits: bad version ${file.version}`);
  }
  for (const k of file.kits) if (!HASH.test(k)) throw new Error(`kits: bad hash ${k}`);
  return new Set(file.kits);
}

export const bundledKits: ReadonlySet<string> = loadKits(bundled);

export function kitMatch(fingerprint: string | null, kits: ReadonlySet<string> = bundledKits) {
  return fingerprint !== null && kits.has(fingerprint);
}
