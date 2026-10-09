/**
 * Single entries pulled from the published lists after a wrong-block report, by entry hash
 * (SHA-256 hex of the canonical expression, as in the snapshot). Lighter than switching off a
 * whole feed: the next publish drops them and clients remove them through the delta.
 * Stored at `config/suppress.json` (never served), edited through `PUT /admin/suppress`.
 */
import { type BlobStore, getJson, putJson } from "./storage.ts";

export const SUPPRESS_KEY = "config/suppress.json";
const HASH = /^[0-9a-f]{64}$/;

export function normalizeSuppressed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((h): h is string => typeof h === "string" && HASH.test(h)))].sort();
}

export async function loadSuppressed(store: BlobStore): Promise<string[]> {
  try {
    return normalizeSuppressed(await getJson(store, SUPPRESS_KEY));
  } catch {
    return [];
  }
}

export async function saveSuppressed(store: BlobStore, raw: unknown): Promise<string[]> {
  const list = normalizeSuppressed(raw);
  await putJson(store, SUPPRESS_KEY, list);
  return list;
}
