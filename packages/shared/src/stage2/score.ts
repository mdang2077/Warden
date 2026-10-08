/**
 * Stage 2 scoring (S2.11): signals → points → one decision per login page. Signals are
 * grouped into evidence families by what they look at; only the strongest signal in each
 * family counts, so related weak signals can't stack. A warn candidate needs an anchor plus
 * evidence from a second family. Weights are hand-set and retuned from the S2.11 harness
 * (packages/eval/reports/STAGE2_SCORE.md); the CI gate re-checks every change. Shadow mode only.
 */
import type { ExfilSignal } from "./exfil-signal.ts";
import type { UrlSignals } from "./url-signals.ts";

export type Stage2Decision = "none" | "suspicious" | "warn_candidate";
export type Family = "pageBrand" | "credentialDestination" | "urlHost";

export interface ScoreInput {
  /** S2.6 brand mismatch, with how many cues backed the claim. */
  brandMismatch: { cues: number } | null;
  exfil: ExfilSignal | null;
  url: UrlSignals;
  /** The page has a secret-entry surface (not an identifier-only step). */
  gated: boolean;
  /** Not allowlisted and not trusted by the user. */
  eligible: boolean;
}

export interface Contribution {
  family: Family;
  signal: string;
  points: number;
  anchor: boolean;
  /** False when a stronger signal in the same family already counted. */
  counted: boolean;
}

export interface ScoreResult {
  points: number;
  decision: Stage2Decision;
  /** The decision with `eligible` forced true: what the CI gate measures. */
  rawDecision: Stage2Decision;
  contributions: Contribution[];
}

export const POINTS = {
  /** A brand claimed by one cue (often the title alone): an anchor, but the weaker one. */
  brandOneCue: 4,
  /** Two or more cues (title + logo, heading, links…): the page really presents as the brand. */
  brandTwoCues: 6,
  /** Credentials sent to a Telegram bot, Discord webhook or form-to-email service: 0 of 374 benign. */
  exfilEndpoint: 6,
  /** A login form posting to another, non-IdP site: rarer in kits, some benign shapes. */
  crossSiteForm: 4,
  /** Visitor-IP lookup in page code: common in kits, also in analytics. Supporting only. */
  ipLookup: 2,
  lookalike: 4,
  brandKeyword: 3,
  ipHost: 3,
  /** Many benign sites live on hosting platforms too. */
  tenantPlatform: 2,
  deepSubdomain: 1,
} as const;

export const WARN_THRESHOLD = 8;

type Fired = Omit<Contribution, "counted">;

function fired(input: ScoreInput): Fired[] {
  const out: Fired[] = [];
  if (input.brandMismatch) {
    const two = input.brandMismatch.cues >= 2;
    out.push({
      family: "pageBrand",
      signal: two ? "brandMismatch:2cues" : "brandMismatch:1cue",
      points: two ? POINTS.brandTwoCues : POINTS.brandOneCue,
      anchor: true,
    });
  }
  const kind = input.exfil?.kind;
  if (kind) {
    out.push({
      family: "credentialDestination",
      signal: `exfil:${kind}`,
      points: kind === "crossSiteForm" ? POINTS.crossSiteForm : POINTS.exfilEndpoint,
      anchor: true,
    });
  }
  if (input.exfil?.ip) {
    out.push({
      family: "credentialDestination",
      signal: "ipLookup",
      points: POINTS.ipLookup,
      anchor: false,
    });
  }
  for (const s of [
    "lookalike",
    "brandKeyword",
    "ipHost",
    "tenantPlatform",
    "deepSubdomain",
  ] as const) {
    if (input.url[s]) out.push({ family: "urlHost", signal: s, points: POINTS[s], anchor: false });
  }
  return out;
}

export function score(input: ScoreInput, threshold = WARN_THRESHOLD): ScoreResult {
  const all = fired(input);
  const best = new Map<Family, Fired>();
  for (const c of all) {
    const b = best.get(c.family);
    if (!b || c.points > b.points || (c.points === b.points && c.anchor && !b.anchor)) {
      best.set(c.family, c);
    }
  }
  const counted = [...best.values()];
  const points = counted.reduce((sum, c) => sum + c.points, 0);
  const warn =
    input.gated && points >= threshold && best.size >= 2 && counted.some((c) => c.anchor);
  const anyAnchor = all.some((c) => c.anchor);
  const decide = (w: boolean): Stage2Decision =>
    w ? "warn_candidate" : anyAnchor ? "suspicious" : "none";
  return {
    points,
    decision: decide(warn && input.eligible),
    rawDecision: decide(warn),
    contributions: all.map((c) => ({ ...c, counted: best.get(c.family) === c })),
  };
}
