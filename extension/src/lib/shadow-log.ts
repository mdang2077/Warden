/**
 * Stage 2 shadow log: what Stage 2 saw, kept on this device only (telemetry is local-only by
 * decision). Entries hold the origin and path, never the query, page text, or anything typed.
 */
import { canonicalize } from "@warden/shared/canonicalize";
import type { SecretKind } from "@warden/shared/page/extract";
import { registrableDomain } from "@warden/shared/psl";
import type { Decision } from "@warden/shared/types";
import { shouldEvaluate } from "./navigation.ts";
import type { KeyValueArea } from "./overrides.ts";

export interface ShadowEntry {
  at: number;
  /** Origin + path only. */
  page: string;
  domain: string | null;
  /** `gate`: the page asks for a secret. `identifier`: a username/email-only step. */
  kind: "gate" | "identifier";
  secrets: Record<SecretKind, number>;
  identifierFields: number;
  /** Stage 0 would have cleared this page (Stage 2 never acts on allowlisted domains). */
  allowlisted: boolean;
  /** Stage 1's decision for the page, when known. */
  stage1: Decision | null;
}

/** What the content script sends: counts only. */
export interface FieldsMessage {
  type: "warden:fields";
  secrets: Record<SecretKind, number>;
  identifierFields: number;
}

const KEY = "shadow_log";
export const MAX_SHADOW_ENTRIES = 2000;
const KINDS: SecretKind[] = ["password", "otp", "card", "seed"];

export async function appendShadowEntry(area: KeyValueArea, entry: ShadowEntry): Promise<void> {
  const log = ((await area.get(KEY))[KEY] as ShadowEntry[] | undefined) ?? [];
  await area.set({ [KEY]: [...log, entry].slice(-MAX_SHADOW_ENTRIES) });
}

export async function listShadowEntries(area: KeyValueArea): Promise<ShadowEntry[]> {
  return ((await area.get(KEY))[KEY] as ShadowEntry[] | undefined) ?? [];
}

/** Validates an untrusted runtime message. */
export function parseFieldsMessage(msg: unknown): FieldsMessage | null {
  const m = msg as Partial<FieldsMessage> | null;
  if (!m || m.type !== "warden:fields" || typeof m.secrets !== "object" || !m.secrets) return null;
  const count = (v: unknown) =>
    Number.isInteger(v) && (v as number) >= 0 ? Math.min(v as number, 1000) : null;
  const secrets = {} as Record<SecretKind, number>;
  for (const k of KINDS) {
    const n = count((m.secrets as Record<string, unknown>)[k]);
    if (n === null) return null;
    secrets[k] = n;
  }
  const identifierFields = count(m.identifierFields);
  if (identifierFields === null) return null;
  return { type: "warden:fields", secrets, identifierFields };
}

export interface RecorderDeps {
  area: KeyValueArea;
  allowlisted: (host: string) => boolean;
  stage1For: (tabId: number, url: string) => Promise<Decision | null>;
  now?: () => number;
}

export function createShadowRecorder(deps: RecorderDeps) {
  const now = deps.now ?? Date.now;
  const seen = new Map<string, number>();

  return async (
    raw: unknown,
    sender: { tabId: number | undefined; frameId: number | undefined; url: string | undefined },
  ): Promise<ShadowEntry | null> => {
    const msg = parseFieldsMessage(raw);
    if (!msg || sender.tabId === undefined || sender.frameId !== 0 || !sender.url) return null;
    if (!shouldEvaluate(sender.url)) return null;
    const url = canonicalize(sender.url);
    if (!url) return null;

    const gated = Object.values(msg.secrets).some((n) => n > 0);
    if (!gated && msg.identifierFields === 0) return null;
    const kind = gated ? "gate" : "identifier";
    const page = `${new URL(sender.url).origin}${new URL(sender.url).pathname}`;

    // One entry per page and kind per tab, within ten minutes (re-renders, SPA re-checks).
    const key = `${sender.tabId}|${kind}|${page}`;
    const t = now();
    const last = seen.get(key);
    if (last !== undefined && t - last < 10 * 60_000) return null;
    seen.set(key, t);

    const entry: ShadowEntry = {
      at: t,
      page,
      domain: registrableDomain(url.host),
      kind,
      secrets: msg.secrets,
      identifierFields: msg.identifierFields,
      allowlisted: deps.allowlisted(url.host),
      stage1: await deps.stage1For(sender.tabId, sender.url),
    };
    await appendShadowEntry(deps.area, entry);
    return entry;
  };
}
