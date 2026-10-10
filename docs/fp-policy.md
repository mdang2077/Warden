# Warden False-Positive Policy

A false positive (warning on or blocking a legitimate site) costs more than a missed phish.
Users who see bogus warnings learn to click through them, and then the real warnings stop working.
This document turns that principle into numbers and rules. Code enforces the rules in
`packages/shared/risk.ts`, and the Phase 4 harness measures the numbers.

When in doubt: don't warn.

---

## 1. FP budget

| Stage | Budget | Measured on |
|---|---|---|
| Stage 1 (deterministic feeds) | **0 `block` decisions** | Tranco top-100k registrable domains (homepages) + ~2k real benign login URLs, excluding paths on known shared hosts |
| Stage 2 (parked) | `warn` on ≤ 0.1% of benign login pages | Phase 4 benign login corpus |
| Stage 2 (parked) | `warn` on effectively 0% of all benign page loads | Guaranteed by the credential gate |

The Stage 1 budget is a CI gate (T4.4): **any** benign `block` fails the build.
Budgets are revisited only after a Phase 4 run, and only to tighten them.

## 2. Decisions

Ordered from least to most severe:

| Decision | Meaning | User-facing UI |
|---|---|---|
| `allow` | Known good, or nothing found | None |
| `escalate` | Suspicious. Logged locally (shadow mode) | **None** |
| `warn` | Dismissible in-page banner (Stage 2, parked) | Soft banner |
| `block` | Full interstitial (`warning.html`) | Interstitial with "Back to safety" and a small "Proceed anyway" link |

A `block` ends the cascade. An allowlist hit doesn't end it outright: it is recorded as an
`allowlist_hit` signal, Stage 1 then skips its local feeds, and only Safe Browsing still runs
(see §5). Later stages treat the signal as "allowed, stop".

## 3. Block-authority table

Each source has a **maximum decision** it may emit. `packages/shared/risk.ts` clamps anything higher
down to the cap, and unit tests cover the clamping.

| Source | Max decision | Notes |
|---|---|---|
| Stage 0: allowlist (Tranco top-N minus shared hosts, user overrides) | `allow` | Can only clear. Safe Browsing still wins over it (see §5) |
| Stage 1: Google Safe Browsing (Tier A) | `block` | Interstitial must attribute the verdict to Google |
| Stage 1: OpenPhish (Tier A) | `block` | URL / path-prefix matching only |
| Stage 1: Phishing.Database (Tier B) | `escalate` | Disabled by default. Can contribute to `block` only when confirmed (see §5) |
| Stage 1: PhishStats (Tier B) | `escalate` | Disabled by default. Same as above |
| Stage 1: CERT Polska warning list (Tier B) | `escalate` | Disabled by default, eval-only. Domain-level entries; shared hosts and allowlisted sites are dropped |
| Stage 2: heuristics / classifier (parked) | `warn` | Can never block |
| Stage 3: LLM adjudicator (parked) | `warn`, veto-only | Can only lower a Stage 2 decision, never raise it |

## 4. Feed tiers

- **Tier A** can `block` on its own: Safe Browsing, OpenPhish.
- **Tier B** alone gives `escalate` (logged, no UI). Tier B plus any other source gives `block`.
- A Tier B feed is promoted to Tier A only after a clean Phase 4 run **and** 2 weeks of shadow
  logs with no allowlist collisions.
- Any feed can be disabled or re-tiered by remote config (kill switch, T3.7). The extension
  respects the change within one sync.

## 5. Stage 1 decision rule

1. Allowlist hit → `allow`, stop. *Exception:* a Safe Browsing hit still wins over the allowlist,
   because SB itself handles compromised popular sites.
2. SB hit **or** Tier A local hit → `block`.
3. Tier B hit alone → `escalate`.
4. Tier B hit + any other source → `block`.
5. Otherwise → `allow`.

## 6. Matching rules

- URLs are canonicalized the Safe Browsing way, in `packages/shared/`, so the service and the extension
  produce identical results.
- Matching is URL / path-prefix (SB host-suffix × path-prefix expressions).
- Host-level matching is allowed **only** when the feed entry is a bare host **and** its
  registrable domain is not on the shared-host list.
- Registrable domains come from the Public Suffix List **including the private section**
  (`a.github.io` and `b.github.io` are different sites).
- On shared hosts (`docs.google.com/forms`, `storage.googleapis.com`, `github.io`, …) only exact
  URL / path-prefix matches count. A blocked `docs.google.com/forms/d/X` never blocks
  `/forms/d/Y` or `docs.google.com`.
- Feed entries whose registrable domain is on the allowlist are dropped at ingest (unless
  path-specific on a shared host) and logged as a feed-quality signal.
- Entries expire after 10 days without being re-seen.

## 7. Fail-open rules

A failure anywhere in the pipeline must never produce a block.

| Failure | Behavior |
|---|---|
| Safe Browsing proxy slower than 1.5 s, errors, or is rate-limited | Treated as no SB hit |
| Local list store (IndexedDB) unavailable or throws | Treated as no local hit |
| Feed service down or snapshot stale | Keep the last good snapshot. Never block everything |
| Snapshot or delta checksum mismatch | Reject the update and keep the last good snapshot |
| Cascade exceeds its total time budget | Use the highest decision reached so far from completed stages, or `allow` |
| Stage 3 LLM timeout (parked) | Downgrade the `warn` candidate to `escalate`. Failing safe here means not warning |

## 8. User overrides

- "Proceed anyway" on the interstitial adds a **session-scoped** bypass for that exact URL.
- An override never hides a Safe Browsing hit unless the user explicitly clicked through it.
- Permanent "this site is safe" overrides (Phase 8, parked) beat Stages 2 and 3 but not Stage 1.

## 9. Privacy

- No full URLs leave the device by default. Remote lookups send only 4-byte SHA-256 hash
  prefixes of URL expressions, as Safe Browsing does.
- The SB proxy never logs prefixes together with client IPs.
- Any LLM call that sends page content is opt-in (parked).
