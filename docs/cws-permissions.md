# Chrome Web Store: permission justifications

Audited 2026-10-08 (T4b.7). Every permission in `packages/extension/wxt.config.ts` is used, so none were removed. `downloads` was added on 2026-10-11 for the forced-download guard. The one-liners below are ready to paste into the store's review form.

**Single purpose:** Warden protects users from phishing pages and from the pop-ups and forced redirects that lead to them.

| Permission | Justification | Used in |
|---|---|---|
| `webNavigation` | Sees each top-level page load in a tab so Warden can check its address against phishing lists before the user enters anything, and so it can tell when a page opened a new tab or redirected the current one. | `entrypoints/background.ts`, `lib/redirects.ts` |
| `webRequest` | Observes (never blocks or modifies) each server redirect hop of a top-level page load, so a phishing page reached through a chain of redirects is still recognized. | `entrypoints/background.ts`, `lib/redirects.ts` |
| `tabs` | Reads the current tab's address to show its verdict in the toolbar popup; closes a pop-up tab or sends a hijacked tab back. | `entrypoints/background.ts`, `lib/hijack-action.ts`, popup, warning page |
| `storage` | Keeps the user's settings, trusted and blocked sites, per-tab verdicts, and the on-device Stage 2 log. Nothing is synced or sent anywhere. | `lib/popup-prefs.ts`, `lib/trusted-sites.ts`, `lib/overrides.ts`, `lib/tab-state.ts`, `lib/hijack-action.ts`, `lib/shadow-log.ts` |
| `alarms` | Refreshes the phishing-list snapshot about once an hour. | `entrypoints/background.ts` |
| `declarativeNetRequest` | Blocks known phishing pages and known pop-up networks before they load, using rules the browser applies itself. | `lib/dnr.ts`, `lib/hijack-rules.ts`, `entrypoints/background.ts` |
| `downloads` | Pauses a download that a page forced on the user (for example a fake installer from another site started by a hijacked click) and asks on the page whether to keep or cancel it. Warden reads only the file's address, name and type to decide; it never opens, scans or uploads files. | `lib/download-handler.ts`, `lib/download-guard.ts`, `entrypoints/background.ts` |
| `unlimitedStorage` | The phishing-list snapshot (hashed URL prefixes) is kept in IndexedDB and can exceed the default quota. | `lib/list-store.ts` |
| Host permission `<all_urls>` | Phishing pages and pop-up hijacks can be on any site. Needed to observe redirects and to run the content scripts that detect login forms and show block notices on any page. | `entrypoints/*.content.ts`, `entrypoints/background.ts` |

**Remote code:** none. Feeds and config are fetched as JSON data only; the built bundle is checked in CI for `eval`, `new Function` and remote scripts (`packages/extension/e2e/bundle.spec.ts`).

**Data use:** for the full wording, see [`privacy-policy.md`](privacy-policy.md). In short: 4-byte hash prefixes go to the Safe Browsing proxy, snapshots are downloaded, and nothing about browsing history, page content or typed data leaves the device.
