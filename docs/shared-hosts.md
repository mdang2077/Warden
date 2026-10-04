# Shared-host list

`shared/src/shared-hosts.json` lists hosts where many unrelated people publish content under
one domain. A phishing report for one user's content says nothing about the rest. Each entry
has a `kind`.

## `path`: users share one host

Google Forms and Docs, S3, SharePoint, Dropbox, URL shorteners: everyone's content lives on
the same host, told apart by path.

- A feed entry matches **only its exact path** (the visited URL's query may differ unless the
  entry has a query of its own). It never acts as a host-level or path-prefix match.
- Bare-host entries (path `/`, no query) are rejected, at ingest and on the client.
- Lookups for other hosts never use a shared host as a parent suffix, so `a.docs.google.com`
  can't match an entry stored under `docs.google.com/`.

## `tenant`: each user gets a subdomain

`*.github.io`, `*.pages.dev`, `*.000webhostapp.com`, …: each subdomain is one customer's site.

- A tenant subdomain (`evil.github.io`) is treated as its **own site**: a bare-host entry blocks
  that tenant and its subdomains, and path prefixes work as usual.
- The platform apex (`github.io`) and `www.` on it get the `path` treatment, and lookups never
  reach them, so no entry can ever cover every tenant.
- Only use `tenant` when the apex is **not** the vendor's own site. If the vendor runs its
  product on other subdomains (Squarespace's `account.squarespace.com`), a tenant entry could
  reach them: use `path` instead.

## Both kinds

Neither kind is ever allowlisted, even if the platform ranks in Tranco: a Tranco rank for
`000webhostapp.com` says nothing about one tenant's page, and allowlisting it would hide every
phish hosted there.

## Adding an entry

1. Add `{ "pattern": "...", "group": "...", "kind": "path" | "tenant" }` to `entries`.
   - `example.com` matches that host only.
   - `*.example.com` matches `example.com` and every subdomain. `tenant` requires this form.
   - Patterns are lowercase hostnames; no paths, ports, or wildcards in the middle.
2. Bump `version` and set `updated` to today's date.
3. Add a case to `shared/src/shared-hosts.test.ts` if the host needs one.
4. Run the Phase 4 eval (`node eval/src/cli.ts`) and note the change in recall and benign flags.

When unsure between kinds, choose `path`: it costs recall, never a false positive. When unsure
whether to list a host at all, list it.
