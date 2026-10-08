# Warden

A Chrome extension (Manifest V3) that blocks known phishing pages and the popups and redirects that lead to them.

Warden is built around one rule: **a false positive costs more than a missed phish.** People who see bogus warnings learn to click through them, and then real warnings stop working. So only curated sources can block a page. Heuristics run in shadow mode and must pass a measured false-positive gate before they're allowed to warn. See [`docs/fp-policy.md`](docs/fp-policy.md).

> **Status:** personal project, under active development. Not on the Chrome Web Store yet. Install it unpacked (below).

## What it does

- **Blocks known phishing URLs.** Warden checks every top-frame navigation, including each hop of a redirect chain. It looks the URL up in Google Safe Browsing (through a small proxy) and in locally synced phishing feeds. On a hit, it shows a warning page with **Back to safety** and a small **Proceed anyway** link.
- **Avoids blocking whole shared sites.** On Google Docs, GitHub Pages, Vercel, SharePoint, URL shorteners and similar hosts, Warden matches exact paths only, so one bad page doesn't block the platform. Popular sites (Tranco top 100k) are on an allowlist.
- **Hijack Guard.** Blocks popups and redirects to known pop-under and ad-hijack networks. Strict mode, opt-in per site, also catches click hijacks. See [Hijack Guard modes](#hijack-guard-modes).
- **Stage 2 heuristics (shadow mode, no UI yet).** On pages that ask for a password or other secret, Warden scores local signals and logs the result on your device only:
  - a brand claimed on a domain the brand doesn't own;
  - credentials sent to a Telegram bot, Discord webhook or form-to-email service;
  - lookalike and brand-keyword domains.
- **Popup:** shows the current tab's verdict and the Hijack Guard settings, lets you trust a site or block it from being opened by other sites, and summarizes the Stage 2 log (login pages seen, pages it would have warned on, and an export).

### Hijack Guard modes

Set per site in the toolbar popup (**On \<site\> → Popups**). Turn the whole feature on or off with **Block popups & redirects**.

| Mode | What it does |
|---|---|
| **Allow** | Hijack Guard is off for this site. Use it if a site's real pop-ups break. |
| **Standard** (default) | Pop-ups and redirects to **known** pop-up/ad networks are blocked before they load. A blocked new tab closes, and a hijacked tab goes back. Sign-in, payment and clicked-link pop-ups keep working. |
| **Strict** (opt-in) | Standard, plus: any new tab or cross-site redirect you didn't cause by clicking a visible link (or submitting a form, typing an address, etc.) is closed or sent back, even to sites on no list. For sites that keep hijacking you. |

Each block shows a short notice on the page for about 3 seconds (turn it off in the popup), a gray count on the toolbar icon, and an entry in the popup's "Blocked N on this page" list. You can also block a site from ever being opened by other sites: tick **Block when other sites open this** on its page. Full details: [`docs/hijack-guard.md`](docs/hijack-guard.md).

### Privacy

- Safe Browsing lookups send 4-byte hash prefixes to the proxy, which forwards them to Google. Never full URLs.
- Feed syncs download published blocklist snapshots.
- No browsing history, telemetry or page content leaves the device.
- The Stage 2 shadow log stays in local extension storage. Full draft policy: [`docs/privacy-policy.md`](docs/privacy-policy.md).

## Install (unpacked)

You need Node 22+ and pnpm. The repo pins pnpm 10.34.6. With Corepack, run `corepack enable pnpm`.

```bash
pnpm install
cd packages/extension
pnpm build                  # writes packages/extension/.output/chrome-mv3/
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `packages/extension/.output/chrome-mv3`. In the macOS file picker, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> to show the hidden `.output` folder.

After rebuilding, click the reload icon on Warden's card. For live reloading, run `pnpm dev`, which starts a separate Chrome profile with Warden loaded.

### Pointing it at a feed service

A plain build has **no phishing lists and no Safe Browsing**. Hijack Guard and the local checks still work. To get list blocking, build against a running feed service:

```bash
WXT_FEED_SERVICE_URL=https://warden-feeds.<subdomain>.workers.dev pnpm build
```

## Feed service

`packages/service/` is a Cloudflare Worker with a cron trigger and an R2 bucket. Every hour it:

1. ingests the phishing feeds;
2. cleans them against the allowlist and the shared-host list;
3. publishes versioned snapshots and deltas;
4. serves them, plus the Safe Browsing proxy.

| Route | Purpose |
|---|---|
| `GET /v1/manifest.json` | Current snapshot manifest, with the live feed config applied (kill switch) |
| `GET /v1/{snapshots,deltas,allowlist,shared-hosts}/…` | Published files |
| `POST /sb/hashes-search` | Safe Browsing v5 proxy (rate-limited per IP) |
| `GET\|PUT /admin/config` | Feed config, bearer `ADMIN_TOKEN` |

Secrets and variables:

| Name | Purpose |
|---|---|
| `SB_API_KEY` | Google Safe Browsing API key |
| `ADMIN_TOKEN` | Optional. Enables `/admin/config` |
| `ALERT_WEBHOOK_URL` | Optional. Feed-quality alerts |
| `WARDEN_DEV_FEEDS` | Local/personal runs only. `1` also publishes feeds whose terms forbid redistribution (OpenPhish, PhishStats), under a separate `dev/` storage prefix. Never set it on a public deployment |

Run it locally (put secrets in `packages/service/.dev.vars`):

```bash
cd packages/service
pnpm exec wrangler dev --test-scheduled --var WARDEN_DEV_FEEDS:1   # serves http://127.0.0.1:8787
curl "http://127.0.0.1:8787/__scheduled?cron=17+*+*+*+*"  # run the pipeline once
```

Then build the extension with `WXT_FEED_SERVICE_URL=http://127.0.0.1:8787`. To run the pipeline once into a local directory without the Worker, use `node packages/service/src/runners/cli.ts [outDir]`.

Deploy with `pnpm run deploy` from `packages/service/` (plain `pnpm deploy` is a different, built-in pnpm command). It needs a Cloudflare account and an R2 bucket named `warden-feeds`.

> **Feed licensing:** OpenPhish and PhishStats terms don't allow redistributing their data, including derived hashes, so a normal (production) run never publishes them: they're ingested for the quality log only. The local command above sets `WARDEN_DEV_FEEDS:1` so your own copy still gets OpenPhish. Safe Browsing and Phishing.Database (MIT) are fine to ship. See Phase 4b in [`docs/taskboard.md`](docs/taskboard.md).

## Development

```bash
pnpm test         # Vitest across all packages
pnpm typecheck
pnpm lint         # Biome
pnpm format
pnpm --filter @warden/extension e2e   # Playwright: loads the unpacked extension
```

### Evaluation

`packages/eval/` measures false positives and recall with the shipping code:

- `node packages/eval/src/cli.ts` runs the **Stage 1** gate: any benign block among the Tranco top 100k plus curated login pages fails CI.
- `node packages/eval/src/stage2/harness.ts extract|score` runs the **Stage 2** harness:
  - `extract` re-runs the signals over crawled login pages and writes `packages/eval/data/stage2-features.jsonl` (signal values only, no URLs).
  - `score --check` fails CI if the benign warn-candidate rate exceeds 0.1%.
- The crawler for building corpora is described in [`docs/crawler.md`](docs/crawler.md). Run phishing crawls only in the hardened Docker setup (`packages/eval/docker/`).

Reports live in [`packages/eval/reports/`](packages/eval/reports/).

## Repository layout

| Path | Contents |
|---|---|
| `packages/extension/` | The MV3 extension (WXT): background service worker, content scripts, popup, warning page |
| `packages/shared/` | Code used by the extension, service and eval: URL canonicalization, PSL, cascade and risk caps, Stage 2 signals and scoring |
| `packages/service/` | Feed aggregation Worker and Safe Browsing proxy |
| `packages/eval/` | FP/recall harnesses, crawler, reports |
| `packages/eval/docker/` | Hardened container for crawling live phishing pages |
| `docs/` | Design plan (`PLAN.md`), task status (`taskboard.md`), FP policy, Hijack Guard guide, shared-host and crawler notes |
| `docs/design/` | Design specs |

## License

Warden's code is under the [MIT License](LICENSE). The pop-up network list is derived from EasyList and is distributed under CC BY-SA 3.0; see [`THIRD_PARTY_NOTICES.txt`](packages/extension/public/THIRD_PARTY_NOTICES.txt).
