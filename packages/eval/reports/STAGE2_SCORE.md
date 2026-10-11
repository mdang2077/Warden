# Stage 2 score report (S2.11)

- Features generated 2026-10-11T19:51:56.866Z (source 523c68469354)
- Rows: 3890 benign, 470 phish, 5 skipped
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
| benign | tranco-home | holdout | 322 | 58 | 58 | 0 | 0 |
| benign | tranco-home | tune | 739 | 147 | 132 | 0 | 0 |
| benign | tranco-login | holdout | 867 | 626 | 45 | 0 | 0 |
| benign | tranco-login | tune | 1928 | 1341 | 115 | 0 | 0 |
| benign | universities | holdout | 1 | 1 | 0 | 0 | 0 |
| benign | universities | tune | 3 | 3 | 0 | 0 | 0 |
| phish | openphish | holdout | 159 | 109 | 67 | 27 | 27 |
| phish | openphish | tune | 289 | 172 | 137 | 53 | 52 |
| phish | phishstats | tune | 22 | 0 | 22 | 0 | 0 |

## Threshold sweep (gated pages, raw)

| Threshold | Benign warn | Phish warn |
|--:|--:|--:|
| 6 | 0 of 2206 (0.00%) | 93 of 281 (33.10%) |
| 7 | 0 of 2206 (0.00%) | 80 of 281 (28.47%) |
| 8 | 0 of 2206 (0.00%) | 80 of 281 (28.47%) |
| 9 | 0 of 2206 (0.00%) | 29 of 281 (10.32%) |
| 10 | 0 of 2206 (0.00%) | 29 of 281 (10.32%) |

## Signal fire counts (gated pages)

| Signal | Benign | Phish |
|---|--:|--:|
| brandMismatch:1cue | 55 | 81 |
| brandMismatch:2cues | 26 | 58 |
| exfil:telegram | 0 | 39 |
| exfil:discord | 0 | 7 |
| exfil:formService | 0 | 9 |
| exfil:crossSiteForm | 12 | 7 |
| ipLookup | 16 | 28 |
| lookalike | 0 | 0 |
| brandKeyword | 1 | 38 |
| ipHost | 0 | 0 |
| tenantPlatform | 0 | 97 |
| deepSubdomain | 0 | 0 |

## Warn-candidate combinations (raw)

| Label: counted signals | Pages |
|---|--:|
| phish: brandMismatch:1cue + brandKeyword | 21 |
| phish: brandMismatch:2cues + tenantPlatform | 17 |
| phish: brandMismatch:2cues + brandKeyword | 9 |
| phish: exfil:formService + tenantPlatform | 7 |
| phish: exfil:telegram + tenantPlatform | 6 |
| phish: brandMismatch:1cue + exfil:telegram | 4 |
| phish: brandMismatch:1cue + exfil:discord + tenantPlatform | 3 |
| phish: brandMismatch:1cue + exfil:discord + brandKeyword | 3 |
| phish: brandMismatch:2cues + exfil:telegram + tenantPlatform | 2 |
| phish: brandMismatch:2cues + exfil:telegram | 2 |
| phish: brandMismatch:1cue + exfil:formService + tenantPlatform | 1 |
| phish: brandMismatch:2cues + exfil:telegram + brandKeyword | 1 |
| phish: brandMismatch:1cue + exfil:discord | 1 |
| phish: brandMismatch:1cue + exfil:crossSiteForm + tenantPlatform | 1 |
| phish: brandMismatch:1cue + exfil:telegram + brandKeyword | 1 |
| phish: brandMismatch:1cue + exfil:telegram + tenantPlatform | 1 |

## Benign warn candidates (raw): 0

Hosts are printed by `harness.ts extract` locally and never committed.

| Group | Split | Counted signals |
|---|---|---|
