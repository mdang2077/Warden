# Chrome Web Store listing (draft, T4b.12)

## Name
Warden

## Single purpose
Warden protects you from phishing pages and from the pop-ups and forced redirects that lead to them.

## Short description (≤ 132 characters)
Blocks known phishing pages and the pop-ups and redirects that push you onto them. Free, open source, no tracking.

## Category
Privacy & Security (or Productivity, if Privacy & Security isn't offered)

## Description

Warden does two things:

**Blocks known phishing pages.** Before a page loads, Warden checks its address against Google Safe Browsing. If the page is a known phishing site, a red warning appears instead, with "Back to safety" as the main button. Only hash prefixes of the address leave your device; the full address never does.

**Stops pop-ups and forced redirects.** Streaming and download sites often open ad tabs or redirect you to scam pages when you click. Warden closes those tabs and sends hijacked tabs back, and shows a small notice so you know what happened. Strict mode, which you turn on per site, also catches hijacks from sites on no list. If a junk site keeps coming back, you can block it with one click.

What Warden doesn't do:
- It doesn't catch every phishing page. New ones appear constantly, and Warden only blocks pages already on a list. Be careful where you type passwords.
- It isn't an ad blocker. It only acts on pop-ups and redirects.
- It doesn't collect your browsing history, show ads, or sell anything. It's free and open source (MIT).

Your data stays on your device: settings, trusted and blocked sites, and Warden's logs. See the privacy policy for exactly what is sent and when.

Phishing data from Google Safe Browsing. Google works to provide the most accurate and up-to-date information about unsafe web resources, but cannot guarantee that it is comprehensive and error-free. Pop-up protection uses a list derived from EasyList (CC BY-SA 3.0).

## Screenshots (1280×800)
1. The red warning page on a blocked phishing page, with "Back to safety" and the Google advisory.
2. The toolbar popup on a normal site: "No known threats", the two switches, and the per-site pop-up modes.
3. The "Warden closed a pop-up to …" notice in the corner of a page, with the gray count on the toolbar icon.
4. The popup's "Block when other sites open this" and the Blocked sites list.
5. (Optional) The About page with the credits.

## Privacy practices tab (decide before submitting)
- **Data sent off the device:** 4-byte hash prefixes of visited page addresses, to the Warden feed service and on to Google Safe Browsing; feed list downloads. Nothing is sold, used for ads, or tied to an identity.
- **Open question for you:** whether the store's form counts hash prefixes as "web browsing activity". The conservative choice is to declare it and explain that only non-identifying prefixes are sent, for security.
- Privacy policy URL: `docs/privacy-policy.md`, hosted publicly (for example GitHub Pages) once the repository is public.
- Permission justifications: `docs/cws-permissions.md`.

## Before submitting
- Remove `downloads` from the manifest if experiment H9 hasn't graduated (it adds an install warning).
- Build with the production feed service URL, and add the production manifest key to `manifest-keys.json`.
