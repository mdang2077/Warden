/**
 * Stage 2 brand claim (S2.6, part 1 of 2): which protected brand a login page presents
 * itself as. Two cues: A, brand words where a page identifies itself (title, headings,
 * logo, buttons, field labels); B, the share of the page's off-site references that point
 * at one brand's real domains. No PSL here, so the content script can run it; the
 * mismatch against the page's own domain is brand-mismatch.ts.
 */
import type { Brand, BrandList } from "../brands.ts";
import type { PageSnapshot } from "../page/extract.ts";

export type BrandCue = "title" | "heading" | "logo" | "button" | "label" | "links";

export interface BrandClaim {
  brand: string;
  cues: BrandCue[];
}

export type BrandInput = Partial<
  Pick<PageSnapshot, "title" | "headings" | "buttons" | "logoCandidates" | "forms" | "refHosts">
>;

export interface ClaimThresholds {
  cueA: number;
  cueAWithLinks: number;
  linksWithA: number;
  minRefs: number;
  minShare: number;
}

export const DEFAULT_THRESHOLDS: ClaimThresholds = {
  cueA: 3,
  cueAWithLinks: 2,
  linksWithA: 2,
  minRefs: 3,
  minShare: 0.3,
};

const WEIGHTS = { title: 2, heading: 2, logo: 2, button: 1, label: 1 } as const;
type TextCue = keyof typeof WEIGHTS;

/** Look-alikes NFKC leaves alone (Cyrillic/Greek letters that render like Latin ones). */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ɡ: "g",
  ո: "n",
  ı: "i",
  α: "a",
  ο: "o",
  ρ: "p",
  ν: "v",
  τ: "t",
  κ: "k",
};

export function normalizeText(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFKC").toLowerCase()) out += CONFUSABLES[ch] ?? ch;
  return out.replace(/\s+/g, " ").trim();
}

/*
 * Matching is plain string search over texts normalized once per call: no per-brand
 * regexes. A content script starts cold on every page, and compiling ~200 Unicode-aware
 * regexes cost ~400 ms of main-thread time on first use.
 */

/** Letters and digits in any script: an alias must not sit inside a longer word. */
const WORD_CHAR = /[\p{L}\p{N}]/u;
const isBoundary = (ch: string | undefined) => ch === undefined || !WORD_CHAR.test(ch);

/** Login words in the languages the crawl sees most (for context-only names). */
const LOGIN_WORDS =
  /(?:^|[^\p{L}\p{N}])(sign[\s-]?in|log[\s-]?in|login|log on|inicia(?:r)? sesi[oó]n|entrar|connexion|se connecter|anmelden|accedi|acceso|giriş|masuk)(?=$|[^\p{L}\p{N}])/u;

/** "with" in "sign in with Google", in the same languages. */
const WITH_WORDS = new Set(["with", "using", "via", "con", "avec", "mit", "com", "ile", "dengan"]);
const SOCIAL_ACTION =
  /sign[\s-]?(?:in|up)|log[\s-]?(?:in|on)|login|continue|connect|inicia(?:r)? sesi[oó]n|continuar|entrar|acceder|connexion|se connecter|continuer|anmelden|accedi|giriş|masuk|daftar/u;
const SHARE_BEFORE =
  /(?:share on|follow us on|get it on|download on(?: the)?|available on(?: the)?) $/;

/** "Continue with Google", "Mit Google anmelden", "Share on Facebook": a mention, not an identity. */
function socialMention(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 30), start);
  if (SHARE_BEFORE.test(before)) return true;
  const prev = before.trimEnd().split(" ").pop() ?? "";
  const next = text.slice(end).trimStart().split(" ")[0] ?? "";
  return (WITH_WORDS.has(prev) || WITH_WORDS.has(next)) && SOCIAL_ACTION.test(text);
}

/** `alias` occurs in `text` as a whole word, outside a social-login or share phrase. */
function mentions(text: string, alias: string): boolean {
  for (let i = text.indexOf(alias); i !== -1; i = text.indexOf(alias, i + 1)) {
    const end = i + alias.length;
    if (isBoundary(text[i - 1]) && isBoundary(text[end]) && !socialMention(text, i, end)) {
      return true;
    }
  }
  return false;
}

interface Compiled {
  brand: Brand;
  /** Count anywhere (unless the brand needsContext). */
  names: string[];
  /** Count only in the title or a heading that also has a login word. */
  contextNames: string[];
}

const compiledCache = new WeakMap<BrandList, Compiled[]>();

function compile(brands: BrandList): Compiled[] {
  const cached = compiledCache.get(brands);
  if (cached) return cached;
  const out = brands.brands.map((brand) => {
    const all = brand.aliases.map(normalizeText);
    const extra = (brand.contextAliases ?? []).map(normalizeText);
    return brand.needsContext
      ? { brand, names: [], contextNames: [...all, ...extra] }
      : { brand, names: all, contextNames: extra };
  });
  compiledCache.set(brands, out);
  return out;
}

const MAX_TEXTS = 50;
const MAX_TEXT_LENGTH = 200;

/** A logo candidate is a URL (use its file name) or alt text; data URIs carry no name. */
function logoText(candidate: string): string {
  if (/^data:/i.test(candidate)) return "";
  try {
    const name = new URL(candidate).pathname.split("/").pop() ?? "";
    return decodeURIComponent(name).replace(/[-_.]+/g, " ");
  } catch {
    return candidate;
  }
}

/** Each text normalized once, capped in count and length. */
function prep(list: readonly string[]): string[] {
  return list
    .slice(0, MAX_TEXTS)
    .map((s) => normalizeText(s.slice(0, MAX_TEXT_LENGTH * 2)).slice(0, MAX_TEXT_LENGTH))
    .filter(Boolean);
}

function texts(input: BrandInput): Record<TextCue, string[]> {
  const labels = (input.forms ?? [])
    .flatMap((f) => f.fields.flatMap((field) => [field.label, field.placeholder]))
    .filter(Boolean);
  return {
    title: prep([input.title ?? ""]),
    heading: prep(input.headings ?? []),
    logo: prep((input.logoCandidates ?? []).map(logoText)),
    button: prep(input.buttons ?? []),
    label: prep(labels),
  };
}

function cueA(c: Compiled, byCue: Record<TextCue, string[]>): { score: number; cues: BrandCue[] } {
  let score = 0;
  const cues: BrandCue[] = [];
  for (const cue of Object.keys(WEIGHTS) as TextCue[]) {
    const identityText = cue === "title" || cue === "heading";
    const hit = byCue[cue].some(
      (t) =>
        c.names.some((a) => mentions(t, a)) ||
        (identityText && c.contextNames.some((a) => mentions(t, a)) && LOGIN_WORDS.test(t)),
    );
    if (hit) {
      score += WEIGHTS[cue];
      cues.push(cue);
    }
  }
  return { score, cues };
}

const siteKey = (host: string) => host.split(".").slice(-2).join(".");

function references(input: BrandInput, brands: BrandList) {
  const perBrand = new Map<string, number>();
  const perOther = new Map<string, number>();
  let all = 0;
  for (const { host, count } of input.refHosts ?? []) {
    all += count;
    const owner = brands.ownerOf(host);
    if (owner) perBrand.set(owner.id, (perBrand.get(owner.id) ?? 0) + count);
    else perOther.set(siteKey(host), (perOther.get(siteKey(host)) ?? 0) + count);
  }
  return { perBrand, perOther, all };
}

export function detectBrandClaim(
  input: BrandInput,
  brands: BrandList,
  t: ClaimThresholds = DEFAULT_THRESHOLDS,
): BrandClaim | null {
  const byCue = texts(input);
  const refs = references(input, brands);
  const candidates: { claim: BrandClaim; strength: number }[] = [];

  for (const c of compile(brands)) {
    const a = cueA(c, byCue);
    const brandRefs = refs.perBrand.get(c.brand.id) ?? 0;
    const rivals = [
      ...refs.perOther.values(),
      ...[...refs.perBrand].filter(([id]) => id !== c.brand.id).map(([, n]) => n),
    ];
    const strongB =
      brandRefs >= t.minRefs &&
      refs.all > 0 &&
      brandRefs / refs.all >= t.minShare &&
      rivals.every((n) => n < brandRefs);
    // Links support a claim but can't make one alone: ordinary login pages link to
    // Facebook, YouTube, and the like far more than to anything else off-site.
    const qualifies =
      a.score >= t.cueA ||
      (strongB && a.score >= 1) ||
      (a.score >= t.cueAWithLinks && brandRefs >= t.linksWithA);
    if (!qualifies) continue;
    const cues: BrandCue[] = [...a.cues];
    if (strongB || brandRefs >= t.linksWithA) cues.push("links");
    const strength = a.score + (strongB ? 3 : brandRefs >= t.linksWithA ? 1 : 0);
    candidates.push({ claim: { brand: c.brand.id, cues }, strength });
  }

  candidates.sort((x, y) => y.strength - x.strength);
  const [best, second] = candidates;
  if (!best || (second && second.strength === best.strength)) return null;
  return best.claim;
}
