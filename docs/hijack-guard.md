# Hijack Guard

Hijack Guard stops the pop-ups, pop-unders, tab-unders and forced redirects that drag you off a page and onto an ad, scam or phishing site. Streaming and file-download sites are the usual culprits. Real pop-ups keep working: sign-in windows, payment windows, and links you deliberately open in a new tab.

It works quietly:
- Warden never adds anything to the page itself.
- A blocked pop-up tab just closes.
- A redirected tab goes back to where you were.
- The only sign on screen is a small gray number on the Warden toolbar icon, which counts blocks on the current page. Red is reserved for phishing.

## Turning it on and off

In the Warden toolbar popup:

- **Block popups & redirects** turns Hijack Guard on or off everywhere. While it's off, your per-site choices are kept and come back when you turn it on again.
- **On \<site\> → Popups: Allow / Standard / Strict** sets the mode for the site you're on. "Site" means the registrable domain of the page you're on, so the setting covers `www.example.com`, `video.example.com` and so on. The setting depends only on the site you're on, never on where the pop-up goes.

Settings take effect right away; no reload needed.

## The three modes

| | Allow | Standard (default) | Strict |
|---|---|---|---|
| Known pop-up/ad networks | Allowed | **Blocked before they load** | **Blocked before they load** |
| Unknown sites opened without your click | Allowed | Allowed | **Closed / sent back** |
| Pop-ups from links you clicked | Allowed | Allowed | Allowed |
| Sign-in and payment pop-ups | Allowed | Allowed | Allowed |
| Typing an address, bookmarks, Back/Forward, reload | Allowed | Allowed | Allowed |

### Standard: every site, unless you change it

Warden keeps a list of known pop-up and ad-hijack networks. It's built from EasyList's pop-up filters plus a small curated list, and it updates with the hourly feed sync. When a page tries to load one of those networks, either in a new tab or by redirecting the current tab, Chrome blocks the load before anything is fetched:

- **A new tab** that a page opened is closed.
- **A redirect of your current tab** is undone by going back.
- If there's nothing to go back to, you see Chrome's "blocked" page instead.

Blocking only applies when another site started the load. If you type a listed network's address yourself, Warden lets it through, though you may see a blocked page for a moment first.

### Strict: for the sites that keep hijacking you

Strict mode is opt-in, one site at a time. It adds a check for destinations that **aren't** on any list. Warden watches which links you actually click on that site, and allows a new tab or cross-site redirect only when one of these is true:

- **New tab:**
  - it stays on the same site;
  - it goes to a site you clicked a visible link to within the last second;
  - it's a known sign-in or payment provider.
- **Same-tab redirect to another site:**
  - you clicked a visible link to that site within the last second;
  - you submitted a form;
  - you started it yourself: typed address, bookmark, Back/Forward, reload.

Everything else gets closed or sent back. Two things count as a hijack even though you clicked:
- **Invisible links don't count as clicks.** Hijack scripts often lay a transparent link over the whole page, so a link must be visible (not nearly transparent, and not covering most of the screen) to count.
- **Script redirects after an ordinary click don't count either.** The classic "click the play button, land on a scam page" is a click followed by a script redirect, not a click on a link.

Limits of Strict mode:
- **It can only react after the fact.** Chrome extensions can't cancel these requests before they start, so a tab may flash for a moment before Warden closes it or goes back. Standard blocks known networks before anything loads.
- **When in doubt it allows.** If Warden hasn't seen a click record, for example right after the extension restarted, it lets the navigation through rather than risk breaking a real link.

Your clicks are only checked in memory for a few seconds. They're never stored and never leave your device.

### Allow: turn it off for one site

Allow switches Hijack Guard off for that site, known networks included. Use it if a site's legitimate pop-ups break, and tell us which site so the list can be fixed.

## Seeing what was blocked

The toolbar popup shows **Blocked N on this page**. Expand it to see each blocked destination, whether it was a new tab or a redirect, and how long ago it happened. The list resets when you move to a different site.

## Relationship to phishing protection

Hijack Guard and phishing protection are separate:
- Being on a popular-sites allowlist doesn't exempt a pop-up network.
- A hijack block never shows the red phishing warning page.
- If a pop-up or redirect lands on a known **phishing** page, the phishing warning still appears as usual.

For the design details, see [`design/2026-10-06-hijack-guard-design.md`](design/2026-10-06-hijack-guard-design.md).
