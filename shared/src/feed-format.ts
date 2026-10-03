/**
 * Wire format between the feed service and the extension. Everything is JSON except the
 * allowlist (newline-separated registrable domains). Every file the manifest references
 * carries a SHA-256 of its exact bytes; clients reject a file whose checksum doesn't match.
 */
import { sha256, toHex } from "./expressions.ts";
import type { FeedId, FeedTier } from "./types.ts";

export const FORMAT_SCHEMA = 1;

export interface FeedSettings {
  enabled: boolean;
  tier: FeedTier;
}

export interface PublishedEntry {
  /** Full SHA-256 of `expression`, hex. */
  hash: string;
  /** Canonical expression. Needed by the client to compile Tier A DNR rules. */
  expression: string;
  /** Milliseconds since epoch. */
  expiresAt: number;
}

export interface Snapshot {
  schema: typeof FORMAT_SCHEMA;
  version: number;
  created: number;
  /** Only enabled feeds appear; a missing feed has no entries. */
  feeds: Partial<Record<FeedId, PublishedEntry[]>>;
}

export interface FeedDelta {
  /** New entries and entries whose expiry changed (upserts). */
  added: PublishedEntry[];
  /** Hashes to delete. */
  removed: string[];
}

export interface Delta {
  schema: typeof FORMAT_SCHEMA;
  from: number;
  to: number;
  feeds: Partial<Record<FeedId, FeedDelta>>;
}

export interface FileRef {
  key: string;
  sha256: string;
}

export interface Manifest {
  schema: typeof FORMAT_SCHEMA;
  version: number;
  created: number;
  snapshot: FileRef;
  /** Contiguous chain ending at `version`, oldest first. */
  deltas: (FileRef & { from: number; to: number })[];
  allowlist: FileRef & { count: number };
  sharedHosts: FileRef & { version: number };
  /** Live feed config (kill switch). The Worker overlays the current config when serving. */
  feeds: Record<FeedId, FeedSettings>;
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await sha256(text));
}

/**
 * The deltas a client at `from` needs to reach `manifest.version`, or null when it must
 * load the full snapshot instead (too old, from the future, or the chain has a gap).
 */
export function deltaChain(manifest: Manifest, from: number): Manifest["deltas"] | null {
  if (from === manifest.version) return [];
  const start = manifest.deltas.findIndex((d) => d.from === from);
  if (start === -1) return null;
  const chain = manifest.deltas.slice(start);
  for (let i = 1; i < chain.length; i++) {
    if (chain[i]?.from !== chain[i - 1]?.to) return null;
  }
  return chain.at(-1)?.to === manifest.version ? chain : null;
}
