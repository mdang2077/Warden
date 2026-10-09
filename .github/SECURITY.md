# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use GitHub's
**Report a vulnerability** button on the repository's Security tab (private vulnerability
reporting). Include what you found, how to reproduce it, and what an attacker could do with it.

You can expect an acknowledgement within a few days and a fix or a plan within a few weeks,
depending on severity. Please give us a chance to ship a fix before disclosing publicly.

## Scope

In scope: the Warden extension (`packages/extension`), the feed service and Safe Browsing
proxy (`packages/service`), and the shared code they run (`packages/shared`). Examples:
a way to make Warden block sites it shouldn't (for example by forging or replaying a feed
manifest), to bypass a block, to leak browsing data off the device, or to run code in a page
or the extension.

Out of scope: phishing pages Warden doesn't catch (report those as a regular issue), and the
crawler in `packages/eval` (a research tool that is never shipped).
