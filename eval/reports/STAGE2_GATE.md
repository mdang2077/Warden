# Stage 2 credential-gate report

- Generated 2026-10-05T02:23:44.151Z
- Benign records: 3116 (corpora/crawl-benign)
- Phish records: 669 (corpora/docker/crawl)

## Benign pages

Every gated benign page is one Stage 2 analyzes, so the gate rate is Stage 2's FP surface. Identifier-only pages show a username/email step with no secret field (the first step of a two-step login).

| Group | Crawled | Intercepted | TLS reset | Page seen | Gated | Gate rate | Identifier-only | Password / OTP / card / seed |
|---|--:|--:|--:|--:|--:|--:|--:|---|
| tranco-home | 2039 | 1 | 31 | 1493 | 26 | 1.7% | 0.0% | 26 / 0 / 0 / 0 |
| tranco-login | 937 | 0 | 1 | 917 | 314 | 34.2% | 0.0% | 312 / 5 / 0 / 0 |
| identity-providers | 40 | 0 | 0 | 39 | 9 | 23.1% | 0.0% | 9 / 0 / 0 / 0 |
| banks | 33 | 0 | 0 | 29 | 12 | 41.4% | 0.0% | 12 / 0 / 0 / 0 |
| consumer-accounts | 29 | 0 | 0 | 24 | 9 | 37.5% | 0.0% | 9 / 0 / 0 / 0 |
| universities | 20 | 0 | 0 | 18 | 4 | 22.2% | 0.0% | 4 / 0 / 0 / 0 |
| shared-host-user-content | 18 | 0 | 0 | 17 | 0 | 0.0% | 0.0% | 0 / 0 / 0 / 0 |
| **all** | 3116 | 1 | 32 | 2537 | 374 | 14.7% | 0.0% | 372 / 5 / 0 / 0 |

## Phish pages

Gate rate on seen phish is the ceiling on Stage 2 recall: a page the gate misses can never get a warning. _Intercepted_ pages were replaced by an ISP filter or the site's provider (CDN/host takedown); _TLS reset_ crawls had their handshake cut off, typical of filters that block by server name. Neither says anything about the page, so both are excluded from the gate rate.

| Group | Crawled | Intercepted | TLS reset | Page seen | Gated | Gate rate | Identifier-only | Password / OTP / card / seed |
|---|--:|--:|--:|--:|--:|--:|--:|---|
| openphish | 300 | 44 | 161 | 25 | 3 | 12.0% | 0.0% | 2 / 1 / 0 / 0 |
| phishing_database | 369 | 203 | 0 | 12 | 0 | 0.0% | 0.0% | 0 / 0 / 0 / 0 |
| **all** | 669 | 247 | 161 | 37 | 3 | 8.1% | 0.0% | 2 / 1 / 0 / 0 |
