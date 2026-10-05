# Stage 2 credential-gate report

- Generated 2026-10-05T02:05:33.604Z
- Benign records: 2508 (corpora/crawl-benign)
- Phish records: 300 (corpora/docker/crawl)

## Benign pages

Every gated benign page is one Stage 2 analyzes, so the gate rate is Stage 2's FP surface. Identifier-only pages show a username/email step with no secret field (the first step of a two-step login).

| Group | Crawled | Loaded | Gated | Gate rate | Identifier-only | Password / OTP / card / seed |
|---|--:|--:|--:|--:|--:|---|
| tranco-home | 1586 | 1164 | 20 | 1.7% | 0.0% | 20 / 0 / 0 / 0 |
| tranco-login | 782 | 765 | 260 | 34.0% | 0.0% | 259 / 4 / 0 / 0 |
| identity-providers | 40 | 39 | 9 | 23.1% | 0.0% | 9 / 0 / 0 / 0 |
| banks | 33 | 29 | 12 | 41.4% | 0.0% | 12 / 0 / 0 / 0 |
| consumer-accounts | 29 | 24 | 9 | 37.5% | 0.0% | 9 / 0 / 0 / 0 |
| universities | 20 | 18 | 4 | 22.2% | 0.0% | 4 / 0 / 0 / 0 |
| shared-host-user-content | 18 | 17 | 0 | 0.0% | 0.0% | 0 / 0 / 0 / 0 |
| **all** | 2508 | 2056 | 314 | 15.3% | 0.0% | 313 / 4 / 0 / 0 |

## Phish pages

Gate rate on loaded phish is the ceiling on Stage 2 recall: a page the gate misses can never get a warning. Loaded < crawled means the page was already dead or unreachable.

| Group | Crawled | Loaded | Gated | Gate rate | Identifier-only | Password / OTP / card / seed |
|---|--:|--:|--:|--:|--:|---|
| openphish | 300 | 69 | 3 | 4.3% | 0.0% | 2 / 1 / 0 / 0 |
| **all** | 300 | 69 | 3 | 4.3% | 0.0% | 2 / 1 / 0 / 0 |
