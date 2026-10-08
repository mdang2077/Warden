# Stage 2 brand–domain mismatch report (S2.6)

- Generated 2026-10-07T19:44:25.338Z
- Benign login pages: 374 (corpora/crawl-benign)
- Phish login pages: 130 (corpora/docker/crawl, filtered by --index)
- Brands: 109; detector time: 0.21 ms/page average

Login pages = the crawl found the page gated (secret field) or at an identifier step. Shadow mode only: a mismatch is an anchor signal, not a warning.

## Benign login pages

| Group | Login pages | Claims | Mismatch (raw) | Mismatch (excl. allowlisted) | Raw rate |
|---|--:|--:|--:|--:|--:|
| tranco-home | 26 | 9 | 2 | 0 | 7.7% |
| tranco-login | 314 | 30 | 9 | 0 | 2.9% |
| banks | 12 | 8 | 0 | 0 | 0.0% |
| consumer-accounts | 9 | 6 | 0 | 0 | 0.0% |
| universities | 4 | 0 | 0 | 0 | 0.0% |
| identity-providers | 9 | 7 | 0 | 0 | 0.0% |

## Phish login pages

| Group | Login pages | Claims | Mismatch (raw) | Mismatch (excl. allowlisted) | Raw rate |
|---|--:|--:|--:|--:|--:|
| openphish | 126 | 88 | 83 | 80 | 65.9% |
| phishstats | 4 | 4 | 4 | 4 | 100.0% |

## Benign firings (11)

| Group | Host | Brand | Cues | Allowlisted | Title |
|---|---|---|---|---|---|
| tranco-login | www.mediaexpert.pl | facebook | logo | yes | Media Expert \| Sklep internetowy RTV, AGD, komputery |
| tranco-home | www.caliente.mx | bbva | logo | yes | Casa de Apuestas Deportivas en vivo y Casino Online \| Caliente.mx |
| tranco-home | www.sportybet.com | mastercard | logo | yes | Online Sports Betting International & Live Betting Odds at SportyBet \| SportyBe |
| tranco-login | disqus.com | google | button, label | yes | Log In \| Disqus |
| tranco-login | www.sportybet.com | mastercard | logo | yes | Login |
| tranco-login | www.mediaexpert.pl | facebook | logo | yes | Media Expert \| Sklep internetowy RTV, AGD, komputery |
| tranco-login | www.sportybet.com | mastercard | logo | yes | Login |
| tranco-login | www.theblowers.com | facebook | logo, links | yes | TheBlowers.com - Connection to your member area on The Blowers |
| tranco-login | cloudinary.com | google | logo | yes | Cloudinary - Management Console Login |
| tranco-login | disqus.com | google | button, label | yes | Log In \| Disqus |
| tranco-login | fatalmodel.com | google | button, links | yes | Contratante |

## Phish misses (43)

| Group | Host | Title |
|---|---|---|
| openphish | youko247.github.io |  |
| openphish | yogeshkumar9155.github.io | Ledger — Personal Finance & Multi-Device Wealth Tracker |
| openphish | instabest.vercel.app | Instagram |
| openphish | hensonracingengines.com | Web Mail |
| openphish | www.facebook.com | Facebook |
| openphish | www.e-receipts.co | Manage your Apple ID - Apple |
| openphish | site-xzowfu3b2.godaddysites.com | Hispeed |
| openphish | sonamseeds.in | ConstructConnect Log In |
| openphish | hensonracingengines.com | Secure Document Viewer |
| openphish | sunriseeez.jimdofree.com | Geben Sie Ihre E-Mail-Adresse und Ihr Passwort ein. - Site de sunriseeez ! |
| openphish | candymesa.pages.dev | Ledger — Money clarity for real life |
| openphish | cf234276.tw1.ru | Accuser la réception du courrier 876650341 - AR24 |
| openphish | pub-c443207085e4408eae3253a53de7517c.r2.dev | MTS Mail \| Login |
| openphish | www.facebook.com | Facebook |
| openphish | www.facebook.com | Facebook |
| openphish | www.facebook.com | Facebook |
| openphish | gencat-portal-officedsk.vercel.app | Gencat Office Portal |
| openphish | ivvy25ugqi-h04i.vercel.app | Meta Advertising Standards |
| openphish | nweb.edgeone.dev | Email Update |
| openphish | ucrd77agvo-h04o.vercel.app | Meta Advertising Standards |
| openphish | site-xzowfu3b2.godaddysites.com | Hispeed |
| openphish | mungunshagai.infy.click | PDF Reader |
| openphish | professional-toggle-637485.framer.app | Løgin_Screen |
| openphish | olazamani.github.io |  |
| openphish | yuuinnovations.com | 하이웍스 로그인 |
| openphish | comcastinfoupdatesnow.weebly.com | Login |
| openphish | www.centre-dentaire-bat.com | Secure Document Access |
| openphish | www.facebook.com | Facebook |
| openphish | gencat-portal-officedsk.vercel.app | Gencat Office Portal |
| openphish | site-yep38lzgm.godaddysites.com | hispeed |
| openphish | site-91q65jzg7.godaddysites.com | SITE E-VÉRIFICATION WEBMAIL |
| openphish | fls-a2c8df4e-bec0-497a-ace8-a61f41472676.laravel.cloud |  |
| openphish | site-yep38lzgm.godaddysites.com | hispeed |
| openphish | www.fastusps.com | FastUSPS.com \| Express Postal Delivery & Priority Package Tracking |
| openphish | rich-exceptions-683926.framer.app | My Framer Site |
| openphish | iamailbox.fr | Dynamips - Landing Page |
| openphish | www.wi-rr.com |  |
| openphish | site-wmk4s5qi6.godaddysites.com | Hispeed |
| openphish | hj4292.craftum.io | sunrise |
| openphish | site-91q65jzg7.godaddysites.com | SITE E-VÉRIFICATION WEBMAIL |
| openphish | s3.us-east-2.amazonaws.com | Mail |
| openphish | instabest.vercel.app | Instagram |
| openphish | straightforward-griffin-592982.framer.app | My Framer Site |

## Threshold sweep

| Cue A threshold | Cue B min share | Phish mismatches | Benign mismatches (raw) | Benign excl. allowlisted |
|--:|--:|--:|--:|--:|
| 2 | 0.2 | 87 (66.9%) | 12 (3.2%) | 0 |
| 2 | 0.3 | 87 (66.9%) | 11 (2.9%) | 0 |
| 2 | 0.4 | 87 (66.9%) | 11 (2.9%) | 0 |
| 2 | 0.5 | 87 (66.9%) | 11 (2.9%) | 0 |
| 3 | 0.2 | 37 (28.5%) | 3 (0.8%) | 0 |
| 3 | 0.3 | 37 (28.5%) | 2 (0.5%) | 0 |
| 3 | 0.4 | 37 (28.5%) | 2 (0.5%) | 0 |
| 3 | 0.5 | 37 (28.5%) | 2 (0.5%) | 0 |
| 4 | 0.2 | 34 (26.2%) | 3 (0.8%) | 0 |
| 4 | 0.3 | 34 (26.2%) | 2 (0.5%) | 0 |
| 4 | 0.4 | 34 (26.2%) | 2 (0.5%) | 0 |
| 4 | 0.5 | 34 (26.2%) | 2 (0.5%) | 0 |
