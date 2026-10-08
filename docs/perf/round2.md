# Performance — ronde 2 (fonts, CSS, JS, navigatie, caching)

Vervolg op [baseline.md](baseline.md) en [results.md](results.md). Zelfde opzet: productiebuild op
`localhost:3001` (demo-tenant), Postgres in Docker, `npm run perf` (server/queries/bytes) en
`npm run perf:lighthouse` (Lighthouse 13, mediaan van 3). Gemeten 2026-10-08 (nacht), machine deels belast
door parallelle agents (load 7–16): TTFB's < 15 ms zijn ruis, bytes/queries zijn deterministisch.
"Voor" = de code bij aanvang van deze ronde (incl. ronde 1), "na" = eindstand. De ruwe JSON staat in
`.local/perf/r2-voor*`, `r2-final2*` (git-ignored).

> **Let op bij het vergelijken van HTML-groottes:** de parallelle SEO/GEO-agent voegde in dezelfde periode
> JSON-LD toe (o.a. ItemList op cataloguspagina's: /shop-HTML +7 kB raw ×2). Dat zit in de "na"-cijfers.

## Twee manieren van meten (belangrijk)

Lighthouse meet standaard met **gesimuleerde throttling** ("simulate", Lantern): het laadt de pagina
onbelemmerd (lokaal: alles binnen ~80 ms) en *rekent* daarna uit hoe lang het op 4G + 4× trage CPU had
geduurd. Lantern neemt in die berekening **alle requests mee die in de onbelemmerde run vóór de LCP
klaar waren**. Lokaal is ~150 kB JavaScript (React + Next.js runtime ≈ 120 kB, app-code ≈ 20–30 kB)
binnen 10 ms geladen en uitgevoerd vóórdat de productfoto geschilderd wordt, dus telt Lantern die hele
JS-download mee in de LCP — ook al wacht een echte browser daar niet op (scripts zijn `async`).
Gevolg: de gesimuleerde mobiele LCP van een React/Next-pagina zit vast rond **"alle bytes vóór LCP" /
4G-bandbreedte ≈ 2,4–3,3 s**, wat je ook doet aan CSS, fonts of afbeeldingen.

Daarom meet het script nu ook met **toegepaste throttling** (`PERF_LH_THROTTLING=devtools`): de pagina
laadt écht over een vertraagd netwerk (Lighthouse-mobiel: ~560 ms RTT, 1,5 Mbit/s) en trage CPU. Dat is
het realistische beeld van een eerste bezoek op 4G en de maat waarop de beslissingen hieronder zijn genomen.

## Resultaat in het kort

| | mobiel LCP, toegepaste throttling | mobiel FCP, toegepast | mobiel LCP, simulate | mobiel FCP, simulate |
|---|---|---|---|---|
| shop (catalogus, foto = LCP) | 1545¹ → **1342** ms | 1545¹ → **838** ms | 3324 → 3255 ms | 1363 → **1059** ms |
| product | 1580¹ → **1277** | 1580¹ → **826** | 2790 → 2866 | 1363 → **1058** |
| home | 1543¹ → **1217** | 1543¹ → **831** | 2418 → 2943² | 1364 → **1062** |
| CMS-pagina (tekst = LCP) | 1541¹ → **809** | 1541¹ → **809** | 2332 → 2481 | 1062 → **803** |
| admin dashboard | 2004¹ → **1136** | 1657¹ → **839** | 3845 → **2961** | 910 → 945 |
| admin voorraad | 1992¹ → **1160** | 1673¹ → **845** | 3620 → **3114** | 908 → 1063 |

¹ Toegepaste throttling is pas ná de font-, JS- en navigatiewijzigingen ingevoerd: de "voor"-kolom is de
stand vóór de laatste stap (CSS inline). Ten opzichte van de echte nulmeting is de winst dus nog iets groter
(fonts/admin-preloads zijn in simulate al zichtbaar).
² Spreiding: in de runs ervoor 2418–2790 ms; het verschil zit binnen de ruis van Lantern bij deze belasting.

- **Doelen**: shop mobiel LCP < 1,2 s — gehaald voor tekst-LCP (CMS 0,81 s) en vrijwel voor foto-LCP
  (1,22–1,34 s, realistisch gemeten). TBT ≈ 0 (9–25 ms) ✔. CLS 0 op alle shoppagina's ✔ (home had
  0,033 door een categorie-skelet, opgelost). Admin mobiel LCP < 1,8 s ✔ (1,14–1,16 s realistisch;
  simulate 2,96–3,11 s, ondergrens = JS, zie boven).
- Navigatie: klik op een productkaart na hover **50 ms** tot de h1 staat (was 116 ms lokaal, in productie
  scheelt het een volledige server-roundtrip).

## Wat er veranderd is

| # | wijziging | effect | bestanden |
|---|---|---|---|
| 1 | **Shop-fonts zelf gehost per tenant i.p.v. next/font.** Script `npm run fonts:sync` haalt (met next/font's eigen helpers en fallback-metrieken) de woff2-bestanden op, alleen `latin` + `latin-ext`, met content-hash in de naam → `public/fonts/shop/` (60 bestanden, 1,9 MB op schijf; alleen gebruikte bestanden worden ooit gedownload) + gegenereerde tabel. De shop-layout zet **inline** `@font-face` voor alleen de 2–4 families van het thema (heading, body, accent, mono; ~4 kB raw) en **preloadt alleen het latin-bestand van body + heading** (1–2 bestanden). `font-display: swap` + size-adjusted fallback (`"QM Inter Fallback"` = Arial met Inter-metrieken) → geen CLS. | Render-blocking font-CSS weg (was 47 kB raw / 6,3 kB gzip met álle 24 families). Shop CSS-transfer 20 → 13,5 kB vóór inlining. FCP mobiel −300 ms (simulate). | `scripts/fonts/sync-fonts.ts` (nieuw), `public/fonts/shop/*` (nieuw), `src/components/shop/layout/font-faces.generated.ts` (nieuw), `fonts.ts` (herschreven), `ShopFonts.tsx` (nieuw), `fonts.test.ts` (nieuw), `src/app/(shop)/layout.tsx` (**gedeeld**: 3 regels), `package.json` (script) |
| 2 | **Themabouwer-preview laadt fonts on demand.** De bridge krijgt per family de `@font-face`-regels en voegt een `<style>` toe zodra de bouwer een nog niet gedeclareerde font kiest. Getest: Oswald/Merriweather/Big Shoulders laden live in de iframe. | Live wisselen werkt zoals voorheen voor alle 4 presets. | `ThemePreviewBridge.tsx` |
| 3 | **Admin-fonts: alleen body (IBM Plex Sans, latin) preloaden.** Barlow Condensed, Plex Mono en alle latin-ext-bestanden laden bij gebruik (`swap`, metrische fallback). <br>**Later: ook zelf gehost i.p.v. next/font** — `next/font/google` haalde de bestanden tijdens `next build` bij Google op, waardoor een haperend netwerk de (Docker-)build liet falen. `npm run fonts:sync` haalt nu ook de 9 admin-families op (zelfde gewichten, latin + latin-ext, Big Shoulders Stencil zonder fallback-metrieken) → `public/fonts/admin/` (24 bestanden, 485 kB op schijf) + `src/lib/admin-font-faces.generated.ts`. De admin-layout zet de `@font-face`-regels, size-adjusted fallbacks en de `--font-*`-variabelen (klasse `qm-admin-fonts`) inline in één `<style>` en preloadt nog steeds alleen het latin-bestand van IBM Plex Sans. `next build` heeft geen netwerk meer nodig voor fonts. | Preloads 12 → 1 bestand; font-transfer 175 → 89 kB. Admin mobiel LCP (simulate) −0,7 tot −0,9 s. | `src/lib/admin-fonts.ts`, `src/lib/admin-font-faces.generated.ts`, `public/fonts/admin/*`, `src/lib/font-face-css.ts` (gedeeld met shop), `src/app/admin/layout.tsx` |
| 4 | **CSS inline (`experimental.inlineCss`).** Geen render-blocking `<link>`-stylesheets meer. | Realistisch gemeten FCP 1,54 → 0,83 s (shop) en admin LCP 2,0 → 1,14 s. Kosten: zie afwegingen. Pixelvergelijking 16 screenshots (8 pagina's × mobiel/desktop, shop + admin) met/zonder: identiek. | `next.config.ts` (**gedeeld**) |
| 5 | **Onzichtbare widgets uit de vaste bundel.** Alert-dialoog ("Save search"/"Notify me": formulier, Turnstile, copy) laadt pas bij klik (hover/focus preloadt); mini-cart-paneel bij eerste hover; leeftijdscheck en themapreview-bridge via `next/dynamic` alleen als de server ze rendert; wishlist-copy in een eigen module (de hart-knop op elke kaart bundelde alle account-teksten). | App-JS op `/shop` 27 → 21 kB gzip (totaal 155,8 → 150,3 kB; product 165,0 → 161,0). Framework blijft ~120 kB. | `alerts/AlertDialog.tsx`, `alerts/AlertDialogPanel.tsx` (nieuw), `layout/MiniCart.tsx`, `layout/MiniCartPanel.tsx` (nieuw), `layout/lazy.tsx` (nieuw), `account/_copy.ts`, `account/_copy-wishlist.ts` (nieuw), `account/WishlistButton.tsx` |
| 6 | **Intent-prefetch op productkaarten.** `IntentLink`: bij hover (≥ 60 ms), touchstart of focus wordt de hele productpagina geprefetcht (`router.prefetch`, kind full). `staleTimes.static` 300 → 30 s zodat een geprefetchte pagina nooit ouder dan 30 s getoond wordt; `staleTimes.dynamic` blijft 0. | Klik → pagina zonder server-wachttijd (lokaal 116 → 50 ms; productie: −1 RTT + render). Server: hooguit 1 extra render per kaart waar de bezoeker echt op mikt. | `src/components/shop/ui/IntentLink.tsx` (nieuw), `ui/ProductCard.tsx`, `catalog/CatalogList.tsx`, `next.config.ts` |
| 7 | **CLS home**: het skelet van het CATEGORIES-blok (`aspect-[6/1]`, 68 px op mobiel) werd vervangen door een tegel-skelet met dezelfde geometrie (vierkant + 2 regels). | Home mobiel CLS 0,033 → 0. | `ui/Skeleton.tsx`, `blocks/BlockRenderer.tsx` (**gedeeld** met SEO-agent: 2 regels) |
| 8 | **Dashboard-analytics gecachet.** De drie aggregaties over `page_views` (lineair in verkeer) komen 5 min uit de data-cache per tenant/tijdzone/periode; alleen "live bezoekers" (5-min-venster) draait per request. | Dashboard 20 → 17 queries/request, en de zware scans (10+6+2 ms bij 11k rijen, seconden bij miljoenen) hooguit 1× per 5 min. | `src/server/analytics/queries.ts`, `tests/integration/collect.int.test.ts` (mock) |
| 9 | **Immutable caching**: fonts (`/fonts/*`, via `headers()`), en uploads onder `content/` en `branding/` met random/hash-suffix (`c<24 hex>`, `-<12 hex>`). `/fonts/` buiten de proxy (geen CSP/nonce-werk voor statische bestanden). | Herhaalbezoek: geen revalidatie van hero/logo/fonts meer (was `max-age=300`). | `src/app/uploads/[...path]/route.ts` (+test), `next.config.ts`, `src/proxy.ts` (**gedeeld**: matcher +`fonts/`) |
| 10 | **Compressie naar de ingress (aanbevolen setup)**: `compress` in next.config volgt `NEXT_COMPRESS` (default aan). Dockerfile-build-arg `NEXT_COMPRESS`; ingress-nginx-values: brotli (level 5) + gzip voor tekst-types. Docs bijgewerkt. | Brotli ~15–20 % kleiner dan gzip op HTML/JS/CSS, en Node doet geen compressiewerk meer. | `next.config.ts`, `Dockerfile`, `deploy/k8s/ingress-nginx/values.yaml`, `docs/deploy.md` |
| 11 | **Meetscript**: CSS/font-bytes, LCP-element + LCP-fasen, `PERF_LH_PAGES`, `PERF_LH_KEEP` (volledige rapporten bewaren), `PERF_LH_THROTTLING=devtools`. | — | `scripts/perf/lighthouse.ts` |

Gedrag ongewijzigd: tenant-isolatie, CSP (nonce, `style-src 'unsafe-inline'` dekt de inline `<style>`'s),
auth, live voorraad/reserveringen/cart. Alle 4 thema-presets + live preview getest.

## Voor / na — server, queries, bytes (`npm run perf`)

| route | queries voor → na | HTML gzip kB voor → na³ | JS gzip kB voor → na |
|---|---|---|---|
| home | 2 → 2 | 21,1 → 49,7 | 146,6 → 145,7 |
| `/shop` | 2 → 2 | 33,4 → 64,9 | 155,8 → **150,3** |
| categorie | 2 → 2 | 22,8 → 51,7 | 155,8 → **150,3** |
| product | 3 → 3 | 20,9 → 48,1 | 165,0 → **161,0** |
| CMS-pagina | 1 → 1 | 10,4 → 39,9 | 146,6 → 145,7 |
| cart / checkout | 14 / 15 → 14 / 15 | 17,5 / 18,6 → 46,6 / 47,6 | 155,7 / 187,9 → 155,1 / 187,1 |
| admin dashboard | 20 → **17** | 15,3 → 54,7 | 168,0 → 168,0 |
| admin voorraad / product bewerken | 17 / 35 → 17 / 35 | 22,3 / 22,4 → 61,5 / 62,5 | 169,1 / 186,8 → idem |

³ HTML bevat nu de CSS (shop 13,5 kB gzip, admin 17 kB gzip; Next zet hem twee keer in het document:
als `<style>` en in de RSC-payload) — die kwam vroeger als apart bestand. Netto per eerste bezoek: de
aparte CSS-request (render-blocking) vervalt. Zonder inlining (stap 1–3, 5–9) was het: home 22,4,
/shop 37,4 (waarvan ~3 kB SEO-JSON-LD), CMS 12,6 kB. TTFB p50 bleef 4–10 ms (ruis).

## Voor / na — Lighthouse simulate (mediaan van 3)

| pagina | vorm | FCP voor → na | LCP voor → na | CLS | TBT | CSS kB | fonts kB |
|---|---|---|---|---|---|---|---|
| home | mobiel | 1364 → 1062 | 2418 → 2943² | 0 → 0 | 13 → 9 | 20 → 0 (inline) | 59,9 → 59,9 |
| home | desktop | 289 → 286 | 573 → 658 | 0 | 0 | 20 → 0 | 59,9 |
| shop | mobiel | 1363 → 1059 | 3324 → 3255 | 0 | 16 → 21 | 20 → 0 | 44,3 |
| shop | desktop | 331 → 288 | 694 → 673 | 0 | 0 | 20 → 0 | 44,3 |
| shop + q | mobiel | 1370 → 1057 | 2890 → 3081 | 0 | 19 → 18 | 20 → 0 | 44,3 |
| product | mobiel | 1363 → 1058 | 2790 → 2866 | 0 | 14 → 15 | 20 → 0 | 44,3 |
| product | desktop | 329 → 286 | 549 → 650 | 0 | 0 | 20 → 0 | 44,3 |
| CMS-pagina | mobiel | 1062 → 803 | 2332 → 2481 | 0 | 12 → 25 | 20 → 0 | 34,1 |
| admin dashboard | mobiel | 910 → 945 | 3845 → **2961** | 0,021 | 30 → 35 | 19,9 → 0 | 175,5 → **89,4** |
| admin dashboard | desktop | 248 → 366 | 754 → 1034⁴ | 0 | 0 | 19,9 → 0 | 175,5 → 89,4 |
| admin voorraad | mobiel | 908 → 1063 | 3620 → **3114** | 0 | 17 → 11 | 19,9 → 0 | 175,5 → 89,4 |
| admin voorraad | desktop | 248 → 367 | 1080 → 982 | 0 | 0 | 19,9 → 0 | 175,5 → 89,4 |

⁴ Desktop-admin: Lantern-artefact van dezelfde soort — met minder preloads valt de eerste paint in de
onbelemmerde run ná de JS-uitvoering, waardoor JS in de FCP/LCP-graaf komt. Realistisch gemeten is het
admin-beeld juist sterk verbeterd (zie tabel bovenaan).

Tussenmetingen (simulate, mobiel): alleen fonts → FCP home/shop/product 1,36 → 1,06 s, CMS-LCP
2332 → 1958 ms, admin LCP 3845 → 2946 / 3620 → 2805 ms. `inlineCss` in simulate: neutraal (shop LCP
3322 → 3185, CMS 1958 → 2339, admin 2946 → 3257) — in toegepaste throttling −0,3 tot −0,7 s. Omdat
simulate de CSS-roundtrip onderschat en de JS-download overschat, is op de toegepaste meting beslist.

## Afwegingen en bewust níet gedaan

- **`inlineCss`**: + geen render-blocking CSS-roundtrip (grootste winst voor eerste bezoeken = landingspagina's
  uit Google/ads, precies waar LCP telt). − Elk HTML-document +13–17 kB gzip (Next dupliceert de CSS in de
  RSC-payload) en CSS wordt niet apart gecachet: een herhaalde *volledige* paginalaad op 4G is ~0,1–0,2 s
  trager. Client-side navigaties (het gros binnen de shop/admin) dragen géén CSS mee (gecontroleerd).
  Globaal (ook admin, +40 kB gzip per volledige laad; admin-gebruikers zitten meestal op snelle verbindingen).
  Experimentele vlag; terugdraaien = één regel in `next.config.ts`.
- **`loading.tsx` voor product/catalogus** (directe skeleton bij klik) niet gedaan: de pagina streamt dan
  binnen een Suspense-grens, waardoor `notFound()` en de canonieke-slug-`permanentRedirect` na de eerste
  bytes vallen → 200 i.p.v. 404/308 (soft-404's, SEO-schade). Intent-prefetch geeft hetzelfde "direct"-gevoel
  zonder dat risico.
- **`staleTimes.dynamic` > 0** niet gedaan: veel server actions (login, checkout, alerts, …) doen geen
  `revalidatePath`, en de shop toont live beschikbaarheid/cart. Back/forward komt al uit de bfcache.
- **`unstable_dynamicOnHover`** (Link-prop) bestaat in de runtime maar niet meer in de types → niet gebruikt;
  `IntentLink` doet hetzelfde met de publieke `router.prefetch`.
- **Tenant-lookup cachen** (1 PK-query per request): met de standaard per-pod cache van Next zou een
  schorsing of domeinwijziging op andere replica's pas na de TTL doorwerken. De besparing (~0,5–1 ms in
  productie) weegt daar niet tegen op. Pas zinvol met een gedeelde cache-handler (Redis).
- **Statisch renderen / SRI-CSP**: elke shoppagina hangt af van de `Host`-header (multi-tenant) en de admin
  van cookies; zonder nonce zou er nog steeds niets statisch kunnen. Nonce-CSP blijft.
- **AVIF-varianten**: kaartfoto's zijn 6–11 kB WebP; AVIF scheelt ~2 kB per foto maar vraagt herverwerking
  van alle bestaande uploads + extra opslag. Afbeeldingen waren al goed: LCP-foto in de HTML,
  `fetchpriority=high`, eager, juiste `sizes`, varianten 320/800/2000 w, immutable.
- **Shop-CSS splitsen per route**: 75 kB raw / 13,4 kB gzip utilities voor álle shoppagina's (account,
  checkout, …). Tailwind levert één sheet; splitsen kan alleen met aparte entry-CSS per routegroep.
- **Admin product bewerken** (35 parallelle queries, waarvan 4× dezelfde product-bestaanscheck in
  verschillende services): niet aangepast; parallel, dus ~1 roundtrip. Bundelen raakt 4 services.

## Resterende ideeën

1. **103 Early Hints / Link-header** voor de LCP-foto en het body-font: start de downloads vóór de HTML
   binnen is (de foto is nu de laatste ~0,4 s in de realistische LCP van 1,2–1,34 s).
2. **Brotli echt activeren**: images bouwen met `--build-arg NEXT_COMPRESS=false` + de ingress-values
   uitrollen (docs/deploy.md §3/§5).
3. **Gedeelde cache-handler** (Redis) voor `unstable_cache`: maakt de shop-cache consistent over replica's
   en maakt tenant-lookup-caching veilig.
4. **Catalogus-HTML** (/shop 460 kB raw incl. inline CSS): de RSC-payload herhaalt de volledige kaart-markup;
   minder/kortere classes per kaart en kortere upload-URL's in `srcset` schelen per kaart.
5. **Copy-objecten in client-bundels** (`catalogCopy`, `layoutCopy`) ook opsplitsen zoals de wishlist-copy
   (~2 kB gzip).
6. Field-data verzamelen (web-vitals via de bestaande `/api/collect`-beacon) om lab-cijfers te ijken.

## Opnieuw meten

Zie [results.md § Opnieuw meten](results.md#opnieuw-meten). Nieuw:

```bash
PERF_LH_THROTTLING=devtools PERF_LH_FORM_FACTORS=mobile npm run perf:lighthouse   # realistische 4G-meting
PERF_LH_PAGES="home,product" PERF_LH_KEEP=.local/perf/reports npm run perf:lighthouse  # subset + rapporten bewaren
npm run fonts:sync    # na wijziging van FONT_ALLOWLIST of de admin-fonts: fonts + tabellen opnieuw genereren (netwerk nodig)
```
