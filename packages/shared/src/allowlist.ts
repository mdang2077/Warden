/**
 * Stage 0 allowlist: Tranco top-N registrable domains minus shared hosts, plus the user's
 * own "this site is safe" domains. The service builds the domain list (`buildAllowlist`)
 * and ships it as newline-separated text; the extension parses it (`parseAllowlist`).
 *
 * An allowlist hit doesn't end the cascade: Stage 1 skips its local feeds on the
 * `allowlist_hit` signal but still asks Safe Browsing (docs/fp-policy.md §5).
 */
import { canonicalize } from "./canonicalize.ts";
import { registrableDomain } from "./psl.ts";
import type { SharedHostList } from "./shared-hosts.ts";
import type { Signal, SourceId, Stage, StageResult } from "./types.ts";

export interface Allowlist {
  readonly size: number;
  /** True when `host` (canonical) belongs to an allowlisted registrable domain and isn't shared. */
  allows(host: string): boolean;
}

/**
 * Turns ranked domains (e.g. a Tranco CSV column) into a sorted, deduped list of
 * registrable domains, keeping the first `topN` and dropping shared hosts.
 */
export function buildAllowlist(
  rankedDomains: Iterable<string>,
  shared: SharedHostList,
  topN = 100_000,
): string[] {
  const out = new Set<string>();
  let seen = 0;
  for (const raw of rankedDomains) {
    if (seen++ >= topN) break;
    const host = raw.trim().toLowerCase();
    const domain = host && registrableDomain(host);
    if (!domain || shared.isListed(host) || shared.isListed(domain)) continue;
    out.add(domain);
  }
  return [...out].sort();
}

export function serializeAllowlist(domains: readonly string[]): string {
  return `${domains.join("\n")}\n`;
}

export function parseAllowlist(text: string, shared: SharedHostList): Allowlist {
  const domains = new Set(
    text
      .split("\n")
      .map((d) => d.trim())
      .filter(Boolean),
  );
  return createAllowlist(domains, shared);
}

export function createAllowlist(domains: ReadonlySet<string>, shared: SharedHostList): Allowlist {
  return {
    size: domains.size,
    allows(host) {
      // A shared host is never allowlisted, even under a popular domain: docs.google.com
      // carries other people's forms, so google.com's rank says nothing about them.
      if (shared.isListed(host)) return false;
      const domain = registrableDomain(host);
      return domain !== null && domains.has(domain);
    },
  };
}

export interface AllowlistStageDeps {
  /** Null until the first sync delivers an allowlist. */
  allowlist: () => Allowlist | null;
  /** Registrable domains the user marked safe. */
  userDomains: () => ReadonlySet<string>;
  shared: () => SharedHostList;
}

export function createAllowlistStage(deps: AllowlistStageDeps): Stage {
  return {
    id: "stage0_allowlist",
    async evaluate(ctx): Promise<StageResult> {
      const url = canonicalize(ctx.url);
      const signals: Signal[] = [];
      if (url) {
        const domain = registrableDomain(url.host);
        const userHit =
          domain !== null && !deps.shared().isShared(url.host) && deps.userDomains().has(domain);
        const source: SourceId | null = userHit
          ? "user_override"
          : deps.allowlist()?.allows(url.host)
            ? "allowlist"
            : null;
        if (source) signals.push({ id: "allowlist_hit", source });
      }
      return {
        decision: "allow",
        score: signals.length ? 1 : 0,
        signals,
        latency_ms: 0,
        source: "stage0_allowlist",
      };
    },
  };
}

/** True when an earlier stage reported an allowlist hit for this hop. */
export function hasAllowlistHit(prior: readonly StageResult[]): boolean {
  return prior.some((r) => r.signals.some((s) => s.id === "allowlist_hit"));
}
