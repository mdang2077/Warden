# Stage 2 crawler

Crawls pages for the Stage 2 corpora: phishing pages from the feeds (as soon as they're
seen, because they die within hours) and benign login pages. Each crawl saves the redirect
chain, the shared extractor's `PageSnapshot`, the HTML, and a screenshot under
`eval/corpora/`.

## Phish crawls run in Docker, never on the host

Crawled phishing pages run real JavaScript. Three layers keep them contained:

1. **Chromium's sandbox**, which the crawler turns on (Playwright turns it off by default).
   In the container it needs `docker/crawler/seccomp_profile.json`, Playwright's published
   profile: Docker's default plus the namespace syscalls the sandbox uses.
2. **The container**: non-root, read-only filesystem, all capabilities dropped,
   `no-new-privileges`, memory and process limits.
3. **A filtering egress proxy** inside the crawler. Chromium sends every connection
   through it, loopback included: HTTP requests, HTTPS and WebSocket tunnels, preconnects.
   The proxy resolves each host itself, refuses loopback, private, link-local, and
   unresolvable hosts, and connects to the exact address it checked, so DNS rebinding can't
   swap in a private address. WebRTC can't be proxied, so its UDP is disabled
   (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`).
4. **Request and WebSocket routing** applies the same rules inside the browser and records
   why a page's own navigation was refused (`dns: host did not resolve` for dead domains).

```sh
docker compose -f docker/crawler/compose.yaml up -d --build   # start the watcher
docker compose -f docker/crawler/compose.yaml logs -f         # follow it
docker compose -f docker/crawler/compose.yaml down            # stop it
```

Every 30 minutes the watcher polls the feeds (keeping `first_seen` history in
`eval/corpora/docker/feeds/`), then crawls URLs it hasn't crawled yet, newest first. On its
first cycle it also samples up to 100 already-listed URLs per feed. A failed crawl is
retried once, at least 30 minutes later. Cycle summaries go to
`eval/corpora/docker/watch.log`.

The feed history doubles as input for the Stage 1 harness's time split:
`node eval/src/cli.ts --state eval/corpora/docker/feeds`.

## Benign crawls

Benign pages are legitimate sites and can be crawled from the host:

```sh
node eval/src/crawl/cli.ts --input urls.txt --label benign --group logins
```
