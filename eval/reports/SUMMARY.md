# Warden Stage 1 FP baseline

- Run: 2026-10-03T19:50:47.532Z
- Tranco list 94GG2, top 100000
- Benign URLs: 102145
- Phish records: 5307 (openphish 300, phishing_database 5000, phishstats 7) from live fetch (saved to corpora/phish-2026-10-03.json)
- Shared-host list v1
- Allowlist: 99556 registrable domains (Tranco minus shared hosts)
- Phish split: no time split (single snapshot): recall is in-list, i.e. an upper bound
- Safe Browsing: off (offline run; measures Warden's own lists)

**Reading this report.** Most benign URLs are on allowlisted domains, so they can't be blocked by construction; the URLs that actually test matching are the non-allowlisted ones (shared hosts, unranked login paths). The production truth tables count phish from every feed, including Tier B feeds production doesn't use, so overall recall there is low by design: see recall by feed.

## Gate: PASS

Benign `block` decisions under the production config (OpenPhish, Tier A): **0**. Budget: 0.

## Truth tables (production config)

### Block-only view

| | Flagged | Not flagged |
|---|--:|--:|
| **Phish** | TP 206 | FN 5101 |
| **Benign** | FP 0 | TN 102145 |

Precision 100.00% · Recall 3.88% · FPR 0.0000%

### Flagged view (escalate + block)

| | Flagged | Not flagged |
|---|--:|--:|
| **Phish** | TP 206 | FN 5101 |
| **Benign** | FP 0 | TN 102145 |

Precision 100.00% · Recall 3.88% · FPR 0.0000%

## Benign corpus by group

| Group | URLs | Allowlisted | Escalate (prod) | Block (prod) | Flagged, all feeds | Block, no allowlist |
|---|--:|--:|--:|--:|--:|--:|
| tranco-homepages | 100000 | 99556 | 0 | 0 | 0 | 0 |
| tranco-login-paths | 2000 | 1943 | 0 | 0 | 0 | 0 |
| identity-providers | 45 | 43 | 0 | 0 | 0 | 0 |
| consumer-accounts | 29 | 29 | 0 | 0 | 0 | 0 |
| banks | 33 | 33 | 0 | 0 | 0 | 0 |
| universities | 20 | 20 | 0 | 0 | 0 | 0 |
| shared-host-user-content | 18 | 2 | 0 | 0 | 0 | 0 |

_All feeds_ enables Phishing.Database and PhishStats at Tier B. _No allowlist_ removes the client-side Stage 0 check (feeds are still cleaned against it server-side), showing how much the allowlist is doing.

## Recall by feed

| Feed | Tier | Test URLs | Blocked (prod) | Flagged (all feeds) | Recall, block (prod) | Recall, flagged (all) | Lost to allowlist |
|---|---|--:|--:|--:|--:|--:|--:|
| openphish | A | 300 | 206 | 206 | 68.67% | 68.67% | 13 |
| phishing_database | B | 5000 | 0 | 4341 | 0.00% | 86.82% | 328 |
| phishstats | B | 7 | 0 | 7 | 0.00% | 100.00% | 0 |

## Recall by tier (all feeds)

| Tier | Test URLs | Blocked | Escalated | Recall, block | Recall, flagged |
|---|--:|--:|--:|--:|--:|
| A | 300 | 206 | 0 | 68.67% | 68.67% |
| B | 5007 | 0 | 4348 | 0.00% | 86.84% |

## Feed cleaning (production lists)

| Feed | Ingested | Invalid | Allowlist drops | Shared-host drops | TTL drops | Duplicates | Kept |
|---|--:|--:|--:|--:|--:|--:|--:|
| openphish | 300 | 0 | 13 | 81 | 0 | 0 | 206 |

## Benign blocks (production)

None.

## Benign escalations (production, first 50)

None.

## Benign flags with all feeds enabled (first 50)

None.

## Benign blocks without the client allowlist (first 50)

None.

