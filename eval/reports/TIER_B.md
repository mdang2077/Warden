# Tier B promotion report

- Run: 2026-10-04T21:30:10.957Z
- Tranco list Y83KG, top 100000
- Benign URLs: 102145
- Phish records: 5307 (openphish 300, phishing_database 5000, phishstats 7) from eval/corpora/phish-2026-10-03.json
- Shared-host list v2

A Tier B feed is promoted to Tier A only after a clean Phase 4 run **and** 2 weeks of shadow logs with no allowlist collisions (docs/fp-policy.md §4). This report covers the Phase 4 part.

| Feed | Records | Kept | Allowlist collisions | Collision rate | Benign URLs matched | Phish test URLs matched | Caught only by this feed | Phase 4 clean? |
|---|--:|--:|--:|--:|--:|--:|--:|---|
| phishing_database | 5000 | 4757 | 219 | 4.38% | 0 | 4758 | 4758 | no |
| phishstats | 7 | 7 | 0 | 0.00% | 0 | 7 | 7 | yes |

_Allowlist collisions_ are feed entries on Tranco-ranked domains, dropped during cleaning: each one would have been a false positive. _Benign URLs matched_ counts benign corpus URLs that still matched after cleaning.

### phishing_database: allowlist collision samples

- `http://fifththird.changeip.co/36e5d5eba7950002e581fff4867283db/index.php?hmzsowtc185213155169=aswtpfaom5q`
- `http://gopov48146.temp.swtest.ru/c-agricole`
- `http://international.ueh.edu.vn/wp-content/plugins/r4t5y6uyuk/_=-=++==-/_+_=_%5e=-_+.htm?ip=8.2.209.253`
- `http://jobassam.org.md-in-90.webhostbox.net/wp-includes/bform/bofanewreset/bof987654reset/index.html`
- `http://labanqueta.temp.swtest.ru/login/files/login/login.php`
- `http://mailbox07upgrade.dnset.com/25gb_upgrade000mail0wwsvubatunvjfbdkwdwatunvmnubatu0tunvmnubat`
- `http://mulqueenpu.temp.swtest.ru/n546diiler/n546/039242398597/login.php`
- `https://4paii-aqaaa-aaaad-qdlqq-cai.raw.ic0.app/login.html?ytjqnutezh=hniubcmxksoudvfdzxekheqlhufw&ejed=trnlzmoko4mwtou&taq=bpqfkee5rmbrfjw5uit5e5sqnc&nbybhpzdbl=akhero29frblkfma&fotrmzmshl=yxxshabhylpwjldrtfmdwrvo1h3fl`
- `https://5q5d.short.gy/qgjsc1`
- `https://accounts-google-com.google.kalan.skyfencenet.com/v3/signin/identifier?dsh=s252146878:1684563483511991&continue=https://accounts-google-com.google.kalan.skyfencenet.com/&followup=https://accounts-google-com.google.kalan.skyfencenet.com/&ifkv=af_xneen6d6vwqcefwhmy7swb3kot14kkprxv1prx7zgsv_nwsxvtc4td2x6b36a35_jagvtsvdfda&passive=1209600&flowname=glifwebsignin&flowentry=servicelogin`
- `https://afcuuxafcu.changeip.co/afcu22`
- `https://agricol181.temp.swtest.ru/service/c-a/cd2b0c3da6378f7/region.php?particulier`
- `https://b9h.be5.myftpupload.com/thomasboa/bankofamerica20181/signin/0ac816947n/index.php?section=signinpage&update=&cookiecheck=yes&destination=signin`
- `https://b9h.be5.myftpupload.com/thomasboa/bankofamerica20181/signin/0ac816947n/login.php?id=section=signinpage&update=&cookiecheck=yes&destination=nba/review`
- `https://bbfb296d.sibforms.com/serve/muieaa1y1er7b1pv1ac9o4n4nbsq5vfe6behfar05593mnqcm4j9xoncc7p0codyiik0sh8c1vzxu3ehk7hqlyljmvp3iyfybj4bvp3o0lcljpc65gthkqjc3lsqotfj3gjtjtpk28c27hk2d44elzvarudtrrenfw2x87ul8wmp1vsywozwohpuip2onh7qsr1b9l_gat6wpjdt`
- `https://bt-internet-106642.weeblysite.com`
- `https://bt-mail-verification.weeblysite.com`
- `https://cache-di3ni1howvlltvjnzdhztg1nznloqbgaaaaaaa5yyjv5.infura-ipfs.io/ipfs/Qmf7tZsEwX7RM2WwvcMDTfCw8FgrCtbfaR1U4EH15REkqj`
- `https://casper.kinsta.cloud/fr/logaccess.php`
- `https://cberjac587.myportfolio.com`

