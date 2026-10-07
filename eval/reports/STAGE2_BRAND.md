# Stage 2 brand–domain mismatch report (S2.6)

- Generated 2026-10-07T17:02:03.755Z
- Benign login pages: 374 (corpora/crawl-benign)
- Phish login pages: 130 (corpora/docker/crawl, filtered by --index)
- Brands: 109; detector time: 3.26 ms/page average

Login pages = the crawl found the page gated (secret field) or at an identifier step. Shadow mode only: a mismatch is an anchor signal, not a warning.

## Benign login pages

| Group | Login pages | Claims | Mismatch (raw) | Mismatch (excl. allowlisted) | Raw rate |
|---|--:|--:|--:|--:|--:|
| tranco-home | 26 | 8 | 0 | 0 | 0.0% |
| tranco-login | 314 | 28 | 3 | 0 | 1.0% |
| banks | 12 | 11 | 0 | 0 | 0.0% |
| consumer-accounts | 9 | 7 | 0 | 0 | 0.0% |
| universities | 4 | 0 | 0 | 0 | 0.0% |
| identity-providers | 9 | 6 | 0 | 0 | 0.0% |

## Phish login pages

| Group | Login pages | Claims | Mismatch (raw) | Mismatch (excl. allowlisted) | Raw rate |
|---|--:|--:|--:|--:|--:|
| openphish | 126 | 36 | 31 | 30 | 24.6% |
| phishstats | 4 | 4 | 4 | 4 | 100.0% |

## Benign firings (3)

| Group | Host | Brand | Cues | Allowlisted | Title |
|---|---|---|---|---|---|
| tranco-login | packzy.com | facebook | links | yes | Merchant sign-in \| Steadfast Courier |
| tranco-login | www.theblowers.com | facebook | logo, links | yes | TheBlowers.com - Connection to your member area on The Blowers |
| tranco-login | fatalmodel.com | google | button, links | yes | Contratante |

## Phish misses (95)

| Group | Host | Title |
|---|---|---|
| openphish | mhrs-islemyap.vercel.app | MHRS \| Randevu Al |
| openphish | youko247.github.io |  |
| openphish | mirianlopesdossantos1790964700376.0711032.meusitehostgator.com.br | Netflix - Entrar |
| openphish | cuddly-disco-alpha.vercel.app | Autenticación Bancolombia |
| openphish | clone-facebook-ui.vercel.app | Facebook |
| openphish | polverino-kazem68421397.vercel.app | Métadonnées pour les entreprises - Attrait de la page |
| openphish | yogeshkumar9155.github.io | Ledger — Personal Finance & Multi-Device Wealth Tracker |
| openphish | instabest.vercel.app | Instagram |
| openphish | hensonracingengines.com | Web Mail |
| openphish | sllrdandadadads.duckdns.org | MHRS \| Randevu Al |
| openphish | polverino-kazem68421397.vercel.app | Métadonnées pour les entreprises - Attrait de la page |
| openphish | enescelenk522-hub.github.io | Instagram |
| openphish | www.facebook.com | Facebook |
| openphish | junctioncitymainstreetorg.s3.us-east-2.amazonaws.com | Dropbox - Document Access |
| openphish | www.e-receipts.co | Manage your Apple ID - Apple |
| openphish | site-xzowfu3b2.godaddysites.com | Hispeed |
| openphish | 0112532.com | Bet365 - 官方直营 |
| openphish | maqsud-instagram-clone.vercel.app | Login - Instagram Clone |
| openphish | sonamseeds.in | ConstructConnect Log In |
| openphish | hensonracingengines.com | Secure Document Viewer |
| openphish | sunriseeez.jimdofree.com | Geben Sie Ihre E-Mail-Adresse und Ihr Passwort ein. - Site de sunriseeez ! |
| openphish | instagram-blush.vercel.app | Login - Instagram |
| openphish | facebookbonus.emmanueldegreatltd.com | Facebook |
| openphish | maqsud-instagram-clone.vercel.app | Login - Instagram Clone |
| openphish | candymesa.pages.dev | Ledger — Money clarity for real life |
| openphish | cf234276.tw1.ru | Accuser la réception du courrier 876650341 - AR24 |
| openphish | pub-c443207085e4408eae3253a53de7517c.r2.dev | MTS Mail \| Login |
| openphish | mgfloridaconstructions.s3.eu-central-1.amazonaws.com | Dropbox - Document Access |
| openphish | cuddly-disco-alpha.vercel.app | Autenticación Bancolombia |
| openphish | www.facebook.com | Facebook |
| openphish | www.facebook.com | Facebook |
| openphish | www.facebook.com | Facebook |
| openphish | pistgoat.github.io | Instagram |
| openphish | gencat-portal-officedsk.vercel.app | Gencat Office Portal |
| openphish | maqsud-instagram-clone.vercel.app | Login - Instagram Clone |
| openphish | ivvy25ugqi-h04i.vercel.app | Meta Advertising Standards |
| openphish | clone-facebook-ui.vercel.app | Facebook |
| openphish | www.scotiadevicesecurelogin.com | Sign in \| Scotiabank |
| openphish | nweb.edgeone.dev | Email Update |
| openphish | ucrd77agvo-h04o.vercel.app | Meta Advertising Standards |
| openphish | www.facebookbonus.emmanueldegreatltd.com | Facebook |
| openphish | site-xzowfu3b2.godaddysites.com | Hispeed |
| openphish | instagram-blush.vercel.app | Login - Instagram |
| openphish | mungunshagai.infy.click | PDF Reader |
| openphish | professional-toggle-637485.framer.app | Løgin_Screen |
| openphish | undian-shopee1772.blogspot.com | SHOPEE |
| openphish | olazamani.github.io |  |
| openphish | www.imtoke.cc | Multi-chain Wallet \| Supports Bitcoin, Ethereum, BNB Chain, Tron, Polkadot, Pol |
| openphish | mirianlopesdossantos1790964700376.0711032.meusitehostgator.com.br | Netflix - Entrar |
| openphish | maqsud-instagram-clone.vercel.app | Sign Up - Instagram Clone |
| openphish | instagram-blush.vercel.app | Login - Instagram |
| openphish | codeprof-computer-academy.github.io | Facebook |
| openphish | mibancolombia-97bc6f.gitlab.io | Bancolombia - Sucursal Virtual Personas |
| openphish | pennaelectric.s3.eu-central-1.amazonaws.com | Dropbox - Document Access |
| openphish | mismates27272.vercel.app | Foottooos D1sscrettaass |
| openphish | yuuinnovations.com | 하이웍스 로그인 |
| openphish | arshiadeldar.github.io | Sign Up |
| openphish | comcastinfoupdatesnow.weebly.com | Login |
| openphish | www.emmanuelbarrault.com | Sign In \| Made-in-China.com |
| openphish | www.centre-dentaire-bat.com | Secure Document Access |
| openphish | verifycybord.netlify.app | Discord |
| openphish | www.facebook.com | Facebook |
| openphish | mhrs-islemyap.vercel.app | MHRS \| Randevu Al |
| openphish | clone-facebook-ui.vercel.app | Facebook |
| openphish | netflix-welcome-page-clone-in-react.vercel.app | Netflix Clone |
| openphish | gencat-portal-officedsk.vercel.app | Gencat Office Portal |
| openphish | mail.scotiadevicesecurelogin.com | Sign in \| Scotiabank |
| openphish | synergisticfitlifecom.s3.us-east-2.amazonaws.com | Dropbox - Document Access |
| openphish | site-yep38lzgm.godaddysites.com | hispeed |
| openphish | site-91q65jzg7.godaddysites.com | SITE E-VÉRIFICATION WEBMAIL |
| openphish | fls-a2c8df4e-bec0-497a-ace8-a61f41472676.laravel.cloud |  |
| openphish | site-yep38lzgm.godaddysites.com | hispeed |
| openphish | www.fastusps.com | FastUSPS.com \| Express Postal Delivery & Priority Package Tracking |
| openphish | project-0mgdh.vercel.app | Facebook |
| openphish | opendoorarchitecture.s3.us-east-2.amazonaws.com | Dropbox - Document Access |
| openphish | rich-exceptions-683926.framer.app | My Framer Site |
| openphish | iamailbox.fr | Dynamips - Landing Page |
| openphish | cuddly-disco-alpha.vercel.app | Autenticación Bancolombia |
| openphish | serv00valid.vercel.app | Cuenta de Microsoft - Iniciar sesión |
| openphish | www.wi-rr.com |  |
| openphish | www.conewagoventures.com | Login Form |
| openphish | site-wmk4s5qi6.godaddysites.com | Hispeed |
| openphish | hj4292.craftum.io | sunrise |
| openphish | www.i2mind.com | Sign In \| Made-in-China.com |
| openphish | site-91q65jzg7.godaddysites.com | SITE E-VÉRIFICATION WEBMAIL |
| openphish | s3.us-east-2.amazonaws.com | Mail |
| openphish | pistgoat.github.io | Instagram |
| openphish | xfinityteamslogin.weebly.com | Sign in to Xfinity |
| openphish | nodadaobgyn.github.io | Adobe PDF Online |
| openphish | cuddly-disco-alpha.vercel.app | Autenticación Bancolombia |
| openphish | piresebarboza.adv.br | Access your file - OneDrive |
| openphish | instabest.vercel.app | Instagram |
| openphish | insha-ali2704.github.io | Netflix |
| openphish | serv00valid.vercel.app | Cuenta de Microsoft - Iniciar sesión |
| openphish | straightforward-griffin-592982.framer.app | My Framer Site |

## Threshold sweep

| Cue A threshold | Cue B min share | Phish mismatches | Benign mismatches (raw) | Benign excl. allowlisted |
|--:|--:|--:|--:|--:|
| 2 | 0.2 | 85 (65.4%) | 13 (3.5%) | 0 |
| 2 | 0.3 | 85 (65.4%) | 12 (3.2%) | 0 |
| 2 | 0.4 | 85 (65.4%) | 12 (3.2%) | 0 |
| 2 | 0.5 | 85 (65.4%) | 11 (2.9%) | 0 |
| 3 | 0.2 | 35 (26.9%) | 4 (1.1%) | 0 |
| 3 | 0.3 | 35 (26.9%) | 3 (0.8%) | 0 |
| 3 | 0.4 | 35 (26.9%) | 3 (0.8%) | 0 |
| 3 | 0.5 | 35 (26.9%) | 2 (0.5%) | 0 |
| 4 | 0.2 | 36 (27.7%) | 4 (1.1%) | 0 |
| 4 | 0.3 | 36 (27.7%) | 3 (0.8%) | 0 |
| 4 | 0.4 | 36 (27.7%) | 3 (0.8%) | 0 |
| 4 | 0.5 | 36 (27.7%) | 2 (0.5%) | 0 |
