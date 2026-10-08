# Stage 2 score report (S2.11)

- Features generated 2026-10-08T05:59:56.188Z (source dd5e63358b27)
- Rows: 2454 benign, 130 phish, 2 skipped
- Threshold 8; CI budget: raw benign warn rate on gated pages ≤ 0.1%

_Raw_ = allowlist exemption off (what CI gates). _Eligible_ = as the extension would decide. Identifier-only steps are scored but never warn. Shadow mode only.

## Truth table

| Label | Group | Split | Login pages | Gated | Suspicious | Warn (raw) | Warn (eligible) |
|---|---|---|--:|--:|--:|--:|--:|
| benign | banks | holdout | 1 | 1 | 0 | 0 | 0 |
| benign | banks | tune | 11 | 11 | 0 | 0 | 0 |
| benign | consumer-accounts | holdout | 1 | 1 | 0 | 0 | 0 |
| benign | consumer-accounts | tune | 8 | 8 | 0 | 0 | 0 |
| benign | identity-providers | holdout | 3 | 3 | 0 | 0 | 0 |
| benign | identity-providers | tune | 6 | 6 | 0 | 0 | 0 |
| benign | tranco-home | holdout | 197 | 31 | 42 | 0 | 0 |
| benign | tranco-home | tune | 429 | 78 | 84 | 0 | 0 |
| benign | tranco-login | holdout | 574 | 416 | 32 | 0 | 0 |
| benign | tranco-login | tune | 1220 | 860 | 73 | 0 | 0 |
| benign | universities | holdout | 1 | 1 | 0 | 0 | 0 |
| benign | universities | tune | 3 | 3 | 0 | 0 | 0 |
| phish | openphish | holdout | 32 | 20 | 14 | 11 | 11 |
| phish | openphish | tune | 94 | 56 | 52 | 16 | 16 |
| phish | phishstats | tune | 4 | 0 | 4 | 0 | 0 |

## Threshold sweep (gated pages, raw)

| Threshold | Benign warn | Phish warn |
|--:|--:|--:|
| 6 | 0 of 1419 (0.00%) | 46 of 76 (60.53%) |
| 7 | 0 of 1419 (0.00%) | 41 of 76 (53.95%) |
| 8 | 0 of 1419 (0.00%) | 27 of 76 (35.53%) |
| 9 | 0 of 1419 (0.00%) | 19 of 76 (25.00%) |
| 10 | 0 of 1419 (0.00%) | 10 of 76 (13.16%) |

## Signal fire counts (gated pages)

| Signal | Benign | Phish |
|---|--:|--:|
| brandMismatch:1cue | 39 | 36 |
| brandMismatch:2cues | 20 | 17 |
| exfil:telegram | 0 | 11 |
| exfil:discord | 0 | 4 |
| exfil:formService | 0 | 4 |
| exfil:crossSiteForm | 8 | 1 |
| ipLookup | 11 | 9 |
| lookalike | 0 | 0 |
| brandKeyword | 0 | 25 |
| ipHost | 0 | 0 |
| tenantPlatform | 0 | 46 |
| deepSubdomain | 0 | 0 |

## Warn-candidate combinations (raw)

| Label: counted signals | Pages |
|---|--:|
| phish: brandMismatch:2cues + brandKeyword | 9 |
| phish: brandMismatch:2cues + tenantPlatform | 4 |
| phish: exfil:telegram + tenantPlatform | 2 |
| phish: brandMismatch:1cue + exfil:discord + brandKeyword | 2 |
| phish: exfil:formService + tenantPlatform | 2 |
| phish: brandMismatch:1cue + exfil:telegram | 2 |
| phish: brandMismatch:1cue + exfil:formService + tenantPlatform | 1 |
| phish: brandMismatch:2cues + exfil:telegram | 1 |
| phish: brandMismatch:1cue + exfil:discord | 1 |
| phish: brandMismatch:1cue + exfil:crossSiteForm + tenantPlatform | 1 |
| phish: brandMismatch:1cue + exfil:discord + tenantPlatform | 1 |
| phish: brandMismatch:1cue + exfil:telegram + tenantPlatform | 1 |

## Benign warn candidates (raw): 0

Hosts are printed by `harness.ts extract` locally and never committed.

| Group | Split | Counted signals |
|---|---|---|
