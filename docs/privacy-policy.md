# Warden privacy policy (draft)

*Draft for T4b.9, written 2026-10-08. Each statement below was checked against the code on that date. Re-check before publishing, and host it somewhere public (for example GitHub Pages) once the repository is public.*

Warden is a browser extension that blocks phishing pages and the pop-ups and redirects that lead to them. It does not collect personal data, has no accounts, and contains no analytics or telemetry.

## What leaves your device

Only two kinds of requests, both to the Warden feed service (a Cloudflare Worker run by the Warden project), and only while phishing protection is on:

1. **Safe Browsing lookups.** For each page you open, Warden hashes the page address locally and sends only the first 4 bytes of each hash ("hash prefixes") to the feed service. The service forwards them to Google Safe Browsing and returns the matching full hashes, and the comparison happens on your device. Many unrelated addresses share each prefix, so the prefixes do not reveal which page you visited. Google receives the request from the feed service, not from your browser.
2. **Blocklist downloads.** About once an hour, Warden downloads the current list snapshot and changes from the feed service. These requests contain nothing about you or your browsing.

**What the feed service keeps:** nothing about these requests. It does not log hash prefixes, page addresses, or your IP address. To limit abuse, your IP address is hashed and used as a short-lived rate-limiting key, which Cloudflare holds for about a minute, and it is never stored or combined with your lookups. Cloudflare, as the host, processes connection data such as IP addresses under [its own privacy policy](https://www.cloudflare.com/privacypolicy/).

## What stays on your device

- **Settings:** phishing protection and pop-up blocking on or off, per-site pop-up modes, trusted sites, your blocked-sites list, and whether to show block notices.
- **Stage 2 log:** for login pages only, the page address without its query string or fragment, the site, how many password or code fields the page had, and Warden's verdict (signal names and a score). It never records anything you type, page text, or where a form sends data. It keeps the last 2,000 entries. It leaves your device only if you click **Export log** and share the file yourself.
- **Pop-up and redirect blocks:** the blocked site's name and time, kept per tab for the toolbar badge and cleared when the tab closes.
- **Clicks (Strict mode only):** on sites you set to Strict, Warden notes the time of each click and the address of the visible link you clicked, so it can tell your clicks apart from hijacks. These are held in memory for a few seconds, never written to storage, and never sent anywhere.
- **Pop-up and download experiments:** when a link you clicked on a Strict site ended up on a different site, or a page started a download you didn't click (or an installer from another site), Warden notes the site names, the file type and the time. It never records full addresses or file contents, keeps the last 500 entries, and includes them only in a log you export yourself.
- **"Proceed anyway" choices:** remembered only until you close the browser.

## Permissions

What each browser permission is used for: [`docs/cws-permissions.md`](cws-permissions.md).

## Changes and contact

Changes to this policy will be published in the Warden repository with the date of the change. Questions: open an issue on the Warden GitHub repository.
