# Stage 2 credential-exfiltration report (S2.7)

- Generated 2026-10-07T19:56:40.655Z
- Benign login pages: 374 (corpora/crawl-benign)
- Phish login pages: 130 (corpora/docker/crawl, filtered by --index)

Login pages = the crawl found the page gated or at an identifier step. _Exfil_ = an anchor kind fired (IP lookup is supporting only). _Brand + exfil_ = the page also trips the S2.6 brand mismatch. Shadow mode only.

## Benign login pages

| Group | Login pages | Exfil | Telegram | Discord | Form service | Cross-site form | IP lookup | Brand + exfil |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| tranco-home | 26 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tranco-login | 314 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| banks | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| consumer-accounts | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| universities | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| identity-providers | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Phish login pages

| Group | Login pages | Exfil | Telegram | Discord | Form service | Cross-site form | IP lookup | Brand + exfil |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| openphish | 126 | 23 | 13 | 4 | 4 | 2 | 15 | 13 |
| phishstats | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Benign firings (0)

| Group | Host | Kind | Allowlisted | Title |
|---|---|---|---|---|
