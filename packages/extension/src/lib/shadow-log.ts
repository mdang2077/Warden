/**
 * Stage 2 shadow log: what Stage 2 saw, kept on this device only (telemetry is local-only by
 * decision). Entries hold the origin and path, never the query, page text, or anything typed.
 * When Stage 2's brand signal fires they also hold a brand id and cue names, never the text
 * those came from; when the exfil signal fires, only its kind (never the URL or host).
 * The S2.11 score is stored as points, decision and signal names.
 */
import { type BrandList, bundledBrands } from "@warden/shared/brands";
import { canonicalize } from "@warden/shared/canonicalize";
import type { SecretKind } from "@warden/shared/page/extract";
import { registrableDomain } from "@warden/shared/psl";
import { bundledSharedHosts, type SharedHostList } from "@warden/shared/shared-hosts";
import type { BrandClaim, BrandCue } from "@warden/shared/stage2/brand-claim";
import { brandMismatch } from "@warden/shared/stage2/brand-mismatch";
import type { ExfilEndpoint, ExfilScan } from "@warden/shared/stage2/exfil-scan";
import { type ExfilSignal, exfilSignal } from "@warden/shared/stage2/exfil-signal";
import { bundledKits, kitMatch } from "@warden/shared/stage2/kits";
import { type Stage2Decision, score } from "@warden/shared/stage2/score";
import { urlSignals } from "@warden/shared/stage2/url-signals";
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
  /** S2.6: the page claims this brand on a domain the brand doesn't own. */
  brandMismatch?: BrandClaim;
  /** S2.7: where credentials go (kind only), plus the supporting IP-lookup flag. */
  exfil?: ExfilSignal;
  /** The user trusts this site: Stage 2 never flags or warns on it. Logged, but marked. */
  trusted?: true;
  /** S2.11: the Stage 2 score. Signal names only, never hosts or text. Absent if scoring threw. */
  score?: { points: number; decision: Stage2Decision; signals: string[] };
}

/**
 * What the content script sends: counts, plus (on login pages) a brand id and cue names,
 * and the exfil scan. The scan's form hosts are used to decide cross-site posting here and
 * are never stored.
 */
export interface FieldsMessage {
  type: "warden:fields";
  secrets: Record<SecretKind, number>;
  identifierFields: number;
  brandClaim?: BrandClaim;
  exfil?: ExfilScan;
  /** S2.9 page skeleton hash (page/skeleton.ts), checked against known kits here. */
  kit?: string;
}

const ENDPOINTS = new Set<ExfilEndpoint>(["telegram", "discord", "formService"]);
const HOST = /^[a-z0-9.-]+$/;

function parseExfil(raw: unknown): ExfilScan | null {
  const e = raw as { endpoint?: unknown; ip?: unknown; formHosts?: unknown } | null;
  if (e?.endpoint !== null && !ENDPOINTS.has(e?.endpoint as ExfilEndpoint)) return null;
  if (typeof e?.ip !== "boolean" || !Array.isArray(e.formHosts) || e.formHosts.length > 10) {
    return null;
  }
  if (!e.formHosts.every((h) => typeof h === "string" && HOST.test(h))) return null;
  return {
    endpoint: e.endpoint as ExfilEndpoint | null,
    ip: e.ip,
    formHosts: e.formHosts as string[],
  };
}

const CUES = new Set<BrandCue>(["title", "heading", "logo", "button", "label", "links"]);

function parseClaim(raw: unknown): BrandClaim | null {
  const c = raw as { brand?: unknown; cues?: unknown } | null;
  if (typeof c?.brand !== "string" || !/^[a-z0-9_]+$/.test(c.brand)) return null;
  if (!Array.isArray(c.cues) || c.cues.length > CUES.size) return null;
  if (!c.cues.every((x) => CUES.has(x as BrandCue))) return null;
  return { brand: c.brand, cues: c.cues as BrandCue[] };
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
  if (m?.type !== "warden:fields" || typeof m.secrets !== "object" || !m.secrets) return null;
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
  const claim = parseClaim((m as { brandClaim?: unknown }).brandClaim);
  const exfil = parseExfil((m as { exfil?: unknown }).exfil);
  const kit = (m as { kit?: unknown }).kit;
  return {
    type: "warden:fields",
    secrets,
    identifierFields,
    ...(claim ? { brandClaim: claim } : {}),
    ...(exfil ? { exfil } : {}),
    ...(typeof kit === "string" && /^[0-9a-f]{16}$/.test(kit) ? { kit } : {}),
  };
}

export interface RecorderDeps {
  area: KeyValueArea;
  allowlisted: (host: string) => boolean;
  stage1For: (tabId: number, url: string) => Promise<Decision | null>;
  /** Defaults to the bundled list; null disables the brand signal. */
  brands?: BrandList | null;
  /** True for hosts on sites the user trusts (trusted-sites.ts). */
  trusted?: (host: string) => Promise<boolean>;
  /** The shared-host list for URL signals; defaults to the bundled list. */
  sharedHosts?: () => SharedHostList;
  /** Known kit skeletons; defaults to the bundled list. */
  kits?: ReadonlySet<string>;
  now?: () => number;
}

export function createShadowRecorder(deps: RecorderDeps) {
  const now = deps.now ?? Date.now;
  const brands = deps.brands === undefined ? bundledBrands : deps.brands;
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

    const exfil = msg.exfil ? exfilSignal(msg.exfil, url.host) : null;
    const mismatch =
      msg.brandClaim && brands && brandMismatch(msg.brandClaim, url.host, brands)
        ? msg.brandClaim
        : null;
    const allowlisted = deps.allowlisted(url.host);
    const trusted = (await deps.trusted?.(url.host)) ?? false;
    let scored: ShadowEntry["score"];
    try {
      const shared = deps.sharedHosts?.() ?? bundledSharedHosts;
      const r = score({
        brandMismatch: mismatch ? { cues: mismatch.cues.length } : null,
        exfil,
        url: urlSignals(url, brands, shared),
        kit: kitMatch(msg.kit ?? null, deps.kits ?? bundledKits),
        gated,
        eligible: !allowlisted && !trusted,
      });
      scored = {
        points: r.points,
        decision: r.decision,
        signals: r.contributions.filter((c) => c.counted).map((c) => c.signal),
      };
    } catch (err) {
      console.error("[Warden] Stage 2 scoring failed", err);
    }
    const entry: ShadowEntry = {
      at: t,
      page,
      domain: registrableDomain(url.host),
      kind,
      secrets: msg.secrets,
      identifierFields: msg.identifierFields,
      allowlisted,
      stage1: await deps.stage1For(sender.tabId, sender.url),
      ...(mismatch ? { brandMismatch: mismatch } : {}),
      ...(exfil ? { exfil } : {}),
      ...(trusted ? { trusted: true as const } : {}),
      ...(scored ? { score: scored } : {}),
    };
    await appendShadowEntry(deps.area, entry);
    return entry;
  };
}
