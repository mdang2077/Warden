# Hijack Guard false-positive review: pop-network list vs. Tranco (H4)

- Generated 2026-10-08 from EasyList version 202610081658 (2,594 `$popup` domains) plus the 8 bundled curated domains: 2,595 domains in all.
- Tranco list Y83KG, top 100,000.
- **199 list entries are on Tranco-ranked sites.** 26 are a single subdomain of a bigger site (`try.opera.com`, `paid.outbrain.com`, `track.totalav.com`). Those block only that host, so the rest of the site is unaffected. **173 entries are whole sites**: every page on them is blocked whenever another site opens it, in a new tab or by redirecting the current tab.

Why this matters: EasyList's `$popup` rules only act on new windows, but Warden also blocks same-tab loads that another site starts. So a listed link redirector or affiliate network also breaks ordinary clicks on ordinary sites. The exclusion list `POPUP_NETWORK_EXCLUDES` in `packages/service/src/popup-networks-source.ts` drops entries. **Decided 2026-10-08:** exclude the 7 rows marked "Exclude" below; doubleclick.net and the rest stay blocked.

## Decide: likely to break ordinary clicks

Link redirectors, shorteners and affiliate networks that legitimate sites route normal outbound links through:

| Domain | Tranco rank | What it is | Suggestion |
|---|--:|---|---|
| `redirectingat.com` | 24,008 | Skimlinks: news and review sites send product links through `go.redirectingat.com` | Exclude |
| `s.id` | 18,954 | Public URL shortener (Indonesia) | Exclude |
| `admitad.com` | 21,510 | Affiliate network (coupon and cashback sites) | Exclude |
| `webgains.com` | 35,543 | Affiliate network | Exclude |
| `adtraction.com` | 49,426 | Affiliate network | Exclude |
| `adcell.com` | 34,237 | Affiliate network (Germany) | Exclude |
| `postaffiliatepro.com` | 24,123 | Affiliate software vendor | Exclude |
| `doubleclick.net` | 38 | Google display-ad click redirects | Keep (blocks ad click-throughs, arguably the point) or exclude if ad clicks should work |
| `go2affise.com`, `g2afse.com`, `gotrackier.com` | 32,671 / 15,376 / 19,721 | Affiliate tracking platforms, also used by pop-under campaigns | Keep for now; revisit if a reported break involves them |

## Decide: real destination sites

| Domain | Tranco rank | What it is | Suggestion |
|---|--:|---|---|
| `livejasmin.com`, `bongacams.com`, `cooch.tv` | 10,156 / 8,595 / 53,000 | Adult cam sites, common pop-under destinations | Keep: other sites opening them is almost always a pop-under; typing them still works |
| `shortpixel.ai` | 12,581 | Image-optimization CDN | Keep: pages don't navigate there in the main frame |
| `looksmart.com`, `trellian.com` | 62,368 / 53,951 | Old search and domain companies, now mostly redirect traffic | Keep |

## Expected: ad and pop networks

The remaining ~155 whole-site entries are ad, pop-under, push-notification and traffic networks (`popads.net`, `exoclick.com`, `trafficstars.com`, `propellerads.com`, randomly named pop domains, fake "ad blocker" offers like `totaladblock.com`). Blocking them when another site opens them is the feature working. No action needed.

## Not covered by this review

- Long-tail sites outside the Tranco top 100k. The shadow log doesn't record Hijack Guard blocks; the popup's "Blocked N on this page" list does, so a reported break shows up there.
- The 26 subdomain-only entries: low risk by construction.

## License (the other half of H4)

EasyList's licence page (checked 2026-10-08): the EasyList repository is dual-licensed under GPLv3 or later and CC BY-SA 3.0 Unported or later. Attribution: "The EasyList authors (https://easylist.to/)". `THIRD_PARTY_NOTICES.txt` now states this. The published domain list is derived from EasyList, so it should carry that license (CC BY-SA is the practical choice for a data file). That is compatible with any license for Warden's code. Decide alongside T4b.13.
