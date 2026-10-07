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

const LOGIN_WORDS =
  /(?<![\p{L}\p{N}])(sign[\s-]?in|log[\s-]?in|login|log on|iniciar sesi[oó]n|entrar|connexion|se connecter|anmelden|accedi|acceso|giriş|masuk)(?![\p{L}\p{N}])/u;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Compiled {
  brand: Brand;
  alias: RegExp;
  social: RegExp;
}

const compiledCache = new WeakMap<BrandList, Compiled[]>();

function compile(brands: BrandList): Compiled[] {
  const cached = compiledCache.get(brands);
  if (cached) return cached;
  const out = brands.brands.map((brand) => {
    const names = brand.aliases.map((a) => escapeRegExp(normalizeText(a))).join("|");
    const word = `(?<![\\p{L}\\p{N}])(?:${names})(?![\\p{L}\\p{N}])`;
    const social =
      `(?:(?:sign|log)\\s?(?:in|up)|login|continue|connect)\\s+(?:with|using|via)\\s+${word}` +
      `|share\\s+on\\s+${word}|follow\\s+us\\s+on\\s+${word}|get\\s+it\\s+on\\s+${word}` +
      `|(?:download|available)\\s+on\\s+(?:the\\s+)?${word}`;
    return { brand, alias: new RegExp(word, "u"), social: new RegExp(social, "gu") };
  });
  compiledCache.set(brands, out);
  return out;
}

/** A logo candidate is a URL (use its file name) or alt text. */
function logoText(candidate: string): string {
  try {
    const name = new URL(candidate).pathname.split("/").pop() ?? "";
    return decodeURIComponent(name).replace(/[-_.]+/g, " ");
  } catch {
    return candidate;
  }
}

function texts(input: BrandInput): Record<TextCue, string[]> {
  const labels = (input.forms ?? []).flatMap((f) =>
    f.fields.flatMap((field) => [field.label, field.placeholder]),
  );
  return {
    title: [input.title ?? ""],
    heading: input.headings ?? [],
    logo: (input.logoCandidates ?? []).map(logoText),
    button: input.buttons ?? [],
    label: labels,
  };
}

function cueA(c: Compiled, byCue: Record<TextCue, string[]>): { score: number; cues: BrandCue[] } {
  let score = 0;
  const cues: BrandCue[] = [];
  for (const cue of Object.keys(WEIGHTS) as TextCue[]) {
    if (c.brand.needsContext && cue !== "title" && cue !== "heading") continue;
    const hit = byCue[cue].some((raw) => {
      const t = normalizeText(raw).replace(c.social, " ");
      if (!c.alias.test(t)) return false;
      return !c.brand.needsContext || LOGIN_WORDS.test(t);
    });
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
    const qualifies =
      a.score >= t.cueA || strongB || (a.score >= t.cueAWithLinks && brandRefs >= t.linksWithA);
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
