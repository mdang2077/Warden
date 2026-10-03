# Shared-host list

`shared/src/shared-hosts.json` lists hosts where many unrelated people publish content under
one domain: Google Forms and Docs, S3 and Azure blobs, `github.io`, `pages.dev`, URL
shorteners, and so on. A phishing report for one URL on these hosts says nothing about the
rest of the host.

## What it changes

On a shared host:

- A feed entry matches **only its exact path** (the visited URL's query may differ unless
  the entry has a query of its own). It never acts as a host-level or path-prefix match.
- Bare-host entries (path `/`, no query) are rejected outright, at ingest and on the client.
- Lookups for other hosts never include a shared host as a parent suffix, so
  `a.docs.google.com` can't match an entry stored under `docs.google.com/`.

Shared hosts are also removed from the Stage 0 allowlist (a Tranco rank says nothing about
a single tenant's page).

## Adding an entry

1. Add `{ "pattern": "...", "group": "..." }` to `entries`.
   - `example.com` matches that host only.
   - `*.example.com` matches `example.com` and every subdomain.
   - Patterns are lowercase hostnames; no paths, ports, or wildcards in the middle.
2. Bump `version` and set `updated` to today's date.
3. Add a case to `shared/src/shared-hosts.test.ts` if the host needs one.
4. Run the Phase 4 eval: adding a shared host lowers recall on that host, so note the
   change in the report.

When in doubt, add the host: an extra entry costs some recall, a missing one can cost a
false positive.
