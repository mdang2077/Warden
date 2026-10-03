# Tier B promotion report

- Run: 2026-10-03T19:50:47.532Z
- Tranco list 94GG2, top 100000
- Benign URLs: 102145
- Phish records: 5307 (openphish 300, phishing_database 5000, phishstats 7) from live fetch (saved to corpora/phish-2026-10-03.json)
- Shared-host list v1

A Tier B feed is promoted to Tier A only after a clean Phase 4 run **and** 2 weeks of shadow logs with no allowlist collisions (docs/fp-policy.md §4). This report covers the Phase 4 part.

| Feed | Records | Kept | Allowlist collisions | Collision rate | Benign URLs matched | Phish test URLs matched | Caught only by this feed | Phase 4 clean? |
|---|--:|--:|--:|--:|--:|--:|--:|---|
| phishing_database | 5000 | 4341 | 328 | 6.56% | 0 | 4341 | 4341 | no |
| phishstats | 7 | 7 | 0 | 0.00% | 0 | 7 | 7 | yes |

_Allowlist collisions_ are feed entries on Tranco-ranked domains, dropped during cleaning: each one would have been a false positive. _Benign URLs matched_ counts benign corpus URLs that still matched after cleaning.

### phishing_database: allowlist collision samples

- `http://480321.myshoptet.com/user/documents/upload/facebooks.html`
- `http://a0512393.xsph.ru/nevi-c-agricole/4d2f711dd2c81e3101eb2766cdd73ae1`
- `http://a0537320.xsph.ru/cnughqdgfyrtghed/dhhdfggjgsdjhgyugjdhf`
- `http://a0550277.xsph.ru/fichier/identification/3ea4f3968a4516a/region.php?auth=3ea4f3968a4516a`
- `http://a0609371.xsph.ru/up/01bf0f7499d096b/region.php?auth=01bf0f7499d096b`
- `http://a0616157.xsph.ru/gl4/dnx`
- `http://activation.cd68785.tw1.ru/c.a%20c.a/c.a%20c.a/c.a%20c.a/f399cb2f591b7ab/region.php?particulier`
- `http://arthropodal-departm.000webhostapp.com/onlinebanking/suntrustonline-zelle/online/login/data/6r2gfb6sfh6b14s6w546bh541tsw64b1hsw/1/details.html?61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d-61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d-61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d61727468726f706f64616c2d6465706172746d2e303030776562686f73746170702e636f6d`
- `http://bankofamericax44.webcindario.com/e6b9801f/signonv2screen.php`
- `http://bigamous-threat.000webhostapp.com/lossunt/lost/like/daa/fkjhe7rw792384ewuro28rh/1/1.html?%3c%3fphp_echo_%24negara_%24z_%24anon_%24x_%24isma_%24z_%24nama_negara%3b_%3f%3e=`
- `http://bit.do/fdrfg`
- `http://cb04364-wordpress-l99oo.tw1.ru/dhhl/tracking/fv5ejh/msg.php?id=33986423`
- `http://ce32759.tmweb.ru/c-agricole/bc6e458ca62a41d/region.php?redacted`
- `http://cj83616.tmweb.ru/creditagricole-258djhd99qu/a212b59e26e0a3e50a94c30f581a64be`
- `http://creaturely-satellit.000webhostapp.com/info/cn/index.php`
- `http://diphyletic-muscle.000webhostapp.com/wa_18__(pulberaja)_`
- `http://eventgarenaindia.000webhostapp.com/script%20phising%20garena%20free%20fire%20versi%20blood%20uhuinfo99/login.php`
- `http://f4cboook-la-lognla-facbook-es-bzegveldvg.filesusr.com/html/e36689_e6c41a3a40509f66430172cb264adf11.html?*twf0yxryb2xlczuwmdeqahr0chm6ly93d3cuzmfjzwjvb2suy29tl0xbvefnugvyds92awrlb3mvndi1nju3njy0otu0nze5lyoqzxmq`
- `http://facinorous-spindle.000webhostapp.com/centurylink/35112f/en`
- `http://facinorous-spindle.000webhostapp.com/centurylink/362a2c`

