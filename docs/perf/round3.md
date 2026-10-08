# Performance — ronde 3 (het LCP-beeld: ontdekking, bytes, server)

Vervolg op [results.md](results.md) en [round2.md](round2.md). Onderwerp: pagina's waarvan het LCP-element
een foto is (home-hero, productpagina, catalogus, categorie). Uitgangspunt na ronde 2: realistisch gemeten
mobiel LCP 1,22–1,34 s, tekstpagina's 0,81 s; doel < 1,0 s. Gemeten 2026-10-08 op een productiebuild
(`next build && next start`), demo-tenant, Postgres in Docker, mediaan van 3 Lighthouse-13-runs. De ruwe
JSON/rapporten staan in `.local/perf/r3/` (git-ignored).

## Kernpunt: het doel is in de oude meetmodus fysiek onhaalbaar — daarom een nieuwe meetmodus

`PERF_LH_THROTTLING=devtools` (ronde 2) vertraagt in Chrome **elk request** met 562,5 ms. Die waarde staat
model voor DNS + TCP + TLS + request op een koude verbinding (3,75 × 150 ms RTT). De foto wordt ontdekt in
de eerste HTML-bytes (de preload staat als eerste element in `<head>`, al sinds ronde 1/2), maar betaalt
die 562 ms nóg een keer, terwijl hij in productie over de al open HTTP/2-verbinding komt. De
LCP-fasen laten het zien (voor, mobiel):

| pagina | TTFB→request (load delay) | request→klaar (load duration) | waarvan bytes | LCP |
|---|---|---|---|---|
| home | 576 ms | 607 ms | ~45 ms | 1229 |
| shop | 563 ms | 712 ms | ~150 ms | 1323 |
| product | 559 ms | 689 ms | ~125 ms | 1292 |

Ondergrens voor *elke* foto-LCP in die modus: 2 × 562 ms + render ≈ **1,15 s**, hoe klein de foto ook is.
Geen 103 Early Hint, `Link`-header of preload kan daar iets aan doen (die komen zelf ook pas na 562 ms).

Nieuwe modus **`PERF_LH_THROTTLING=packet`** met `npm run perf:netem` (`scripts/perf/netem-proxy.ts`):
een proxy op :3001 die het netwerk op pakketniveau nabootst zoals WebPageTest dat doet — 150 ms RTT,
gedeelde 1,6 Mbit/s down / 750 kbit/s up (Lighthouse' mobiele profiel), +1 RTT TCP-handshake, TLS 1.3
en HTTP/2 (zoals de ingress in productie), daarachter `next start -p 3002` (Host-header blijft
`localhost:3001`, dus de demo-tenant resolvet). Een koude paginalaad betaalt zo TCP + TLS + request
(≈ 3,5 RTT = 515 ms TTFB, vgl. 562 ms in devtools-modus) en elk volgend request 1 RTT + bytes. Lighthouse
vertraagt in die modus alleen de CPU (mobiel 4×). Desktopprofiel: `PERF_NET_RTT=40 PERF_NET_DOWN_KBPS=10240`.
Niet gemodelleerd: DNS, TCP slow start, pakketverlies (beide modi zijn dus nog steeds lab-cijfers).

Beide modi staan hieronder; de beslissingen zijn op beide getoetst.

## Resultaat in het kort

**Realistisch, pakketniveau (`packet`), mobiel** — voor → na:

| pagina | LCP | FCP | transfer kB | LCP-element |
|---|---|---|---|---|
| home | 813 → 832 | 787 → 824 | 380 → **318** | hero (AVIF) |
| shop | 930 → **897** | 788 → 787 | 454 → **338** | 1e kaart (AVIF 320w) |
| product | 886 → 893 | 776 → 777 | 322 → **301** | galerijfoto (AVIF) |
| categorie | 853 → **805** | 799 → 782 | 326 → **292** | 1e kaart (AVIF 320w) |
| CMS-pagina | 752 → 751 | 752 → 751 | 243 → 244 | tekst |

**Desktop, pakketniveau** (40 ms RTT, 10 Mbit/s): home 288 → 284, shop 296 → 312, product 299 → 287,
categorie 333 → 301, CMS 269 → 258 ms. Op desktop is LCP = FCP: de foto is er vóór de eerste paint.

**Oude modus (`devtools`), mobiel** — voor → na: home 1229 → **1206**, shop 1323 → **1223**, product
1292 → **1193**, categorie 1290 → **1222**, CMS 811 → 813. Load duration nu 594–619 ms = 562 ms
emulatielatentie + 30–55 ms bytes: de ondergrens van die modus is bereikt.
(Desktop in devtools-modus throttlet het netwerk niet: 63–94 ms, niet informatief.)

- **Doel < 1,0 s mobiel**: gehaald in de realistische pakketmodus voor alle foto-pagina's (805–897 ms),
  en daar was het vóór deze ronde ook al (813–930 ms) — de 1,22–1,34 s uit ronde 2 was grotendeels een
  meetartefact. In de devtools-modus is < 1,0 s voor een foto onmogelijk (ondergrens ~1,15 s); we zitten
  er nu op 1,19–1,22 s.
- **CLS** 0 op alle gemeten pagina's (Lighthouse) en ≤ 0,0002 in een eigen meting na volledige laad;
  geen kapotte afbeeldingen; screenshots mobiel (390 px, DPR 3) en desktop gecontroleerd.
- **Bytes**: de LCP-foto op een catalogus­kaart (Moto G-emulatie, 412 px, DPR 1,75) was `card.webp`
  800 w ≈ 7,9 kB, nu `thumb.avif` 320 w ≈ 2,1 kB (−73 %); hero 5,3 → 3,9 kB; productfoto 7,9 → 5,1 kB.
  Paginatransfer mobiel −20 tot −116 kB.

Eerlijk over de pakketmodus: winst op home/product valt binnen de ruis (±30 ms bij 3 runs). Daar wacht de
foto niet meer op zijn eigen bytes maar op het **einde van het HTML-document**: het document (48–67 kB
gzip, hoogste prioriteit) en de foto delen dezelfde 1,6 Mbit/s, en de foto is nu klaar op hetzelfde moment
als het document (bv. home: document klaar 802 ms, hero klaar 834 ms; vóór: product-foto 880–985 ms bij
document klaar 770 ms). Zie "Volgende hefboom".

## Wat er veranderd is

| # | wijziging | waarom / effect | bestanden |
|---|---|---|---|
| 1 | **Breedtes passend bij de echte weergave.** Varianten nu 320 · 480 · 640 · 800 · 1080 · 1440 · 2000 w (thumb · w480 · w640 · card · w1080 · w1440 · large). De extra breedtes worden alleen gemaakt als de bron breder is (geen opgeblazen duplicaten). Per context een *profiel*: `card` (≤ 800 w: kaarten, tegels) en `wide` (480–2000 w: hero, galerij, contentbeelden), zodat niet elke URL in elke `srcset` staat. | Kaart op een Moto G kiest 320 w i.p.v. 800 w; 390 px/DPR 3 kiest 640 w. | `src/lib/media/variants.ts` (nieuw), `src/server/media/images.ts` |
| 2 | **`sizes` gemeten, niet geschat.** Met Playwright de gerenderde breedtes op 390/412/768/1440 px gemeten: kaarten 171/182/224/228–300 css px, hero 358/380/720/1296, galerij 358/720/699. `sizes` nu met `calc()` op paddings/gaps (`calc(50vw - 24px)`, `calc(100vw - 32px)`, `(min-width: 1360px) 700px`, …). Het oude `100vw` / `50vw` / `640px` liet de browser een maat te groot kiezen. | Minder bytes zonder kwaliteitsverlies (gekozen bestand ≥ weergave × DPR). | `ProductGrid.tsx`, `ProductGallery.tsx`, `TextBlocks.tsx`, `ShopBlocks.tsx`, `CatalogList.tsx` |
| 3 | **AVIF + WebP-fallback.** Elke srcset-breedte ook als AVIF (q50, effort 3); `<picture>` met `<source type="image/avif">` en de WebP-`<img>` als fallback. WebP voor nieuwe uploads q72 (was q80). De bron wordt één keer gedecodeerd naar een ≤ 2000 px sRGB-master waaruit alle varianten komen. | Zie § Kwaliteit. | `images.ts`, `ShopImg.tsx`, `ProductGallery.tsx` |
| 4 | **Preload van de AVIF-srcset in `<head>`.** React preloadt een kale `<img>` zelf, maar niet binnen `<picture>`. Een kleine client-component `ImagePreload` roept tijdens SSR `ReactDOM.preload()` aan (`as=image`, `imagesrcset`, `imagesizes`, `type="image/avif"`, `fetchpriority=high`) → `<link>` als eerste element in `<head>`, vóór de inline CSS (byte 144 van het document). Vanuit een server component bereikte het RSC-hint de HTML te laat en verscheen er géén `<link>` (gemeten; ronde 2 zag hetzelfde bij fonts). Browsers zonder AVIF slaan de preload over en vinden de `<img>`. | Ontdekking op de vroegst mogelijke plek voor hero, 1e galerijfoto en de eerste kaartenrij (4 op /shop en categorie). | `ui/ImagePreload.tsx` (nieuw), `ShopImg.tsx`, `ProductGallery.tsx` |
| 5 | **Lightbox-foto `loading="lazy"`.** De 2000 w-foto in de (gesloten) lightbox-`<dialog>` was niet lazy, dus React zette er op élke productpagina een preload voor in `<head>` — 14 kB die met de LCP-foto concurreerde. Nu pas bij openen. | Productpagina mobiel −14 kB vóór LCP. | `ProductGallery.tsx` |
| 6 | **Contentbeelden (CMS) met manifest.** Geen DB-rij, dus `{base}/manifest.json` naast de varianten (breedtes, AVIF, blur-placeholder, afmetingen). Wordt per proces één keer gelezen en in het geheugen gehouden (keys zijn immutable; ontbrekend manifest wordt na 60 s opnieuw gecontroleerd). Zonder manifest: oude thumb/card/large. De hero krijgt nu ook een blur-placeholder. Manifesten worden nooit geserveerd (`/uploads` serveert alleen beeldextensies; getest). | Hero op home gebruikt AVIF + juiste breedtes. | `src/server/media/store.ts` (nieuw), `blocks/images.ts`, `TextBlocks.tsx` (blocks async) |
| 7 | **Eén opslagpad voor varianten.** Upload (product + content), seed en ETL schrijven via `storeProcessedImage` / `storeContentImage`; opslagverbruik telt AVIF-bytes mee (`tenantStorageUsage`, DTO). | Geen vier kopieën van dezelfde schrijflogica meer. | `store.ts`, `product-images.ts`, `pages/[id]/actions.ts`, `scripts/etl/steps/images.ts`, `scripts/seed-demo.ts` |
| 8 | **`npm run media:reprocess`** (eenmalig per omgeving). Vult bestaande uploads aan met de ontbrekende breedtes en AVIF's: product- én contentbeelden, per tenant (`--tenant slug|id`, herhaalbaar, of `--all`), `--dry-run`, `--concurrency`. Bestaande bestanden worden nooit herschreven (ze zijn immutable gecachet). Idempotent (een compleet beeld kost één manifestcheck, geen decode) en hervatbaar (per beeld: bestanden, dan manifest). Op de dev-DB gedraaid voor beide demo-tenants: 229 beelden, 2059 bestanden, 11,1 MB, 42 s; tweede run: 0 bijgewerkt. | Bestaande catalogi profiteren meteen. | `src/server/media/reprocess.ts` (+test), `scripts/media/reprocess.ts`, `package.json` |
| 9 | **Uploads-route**: immutable caching ook voor `{name}.avif` en de nieuwe breedtes (regex), `Content-Type: image/avif`. AVIF's van gevoelige producten krijgen dezelfde 404 voor gasten als WebP (getest). | — | `src/app/uploads/[...path]/route.ts`, `tests/media/uploads-route.test.ts` |
| 10 | **Meetscripts**: pakketmodus + netem-proxy, categoriepagina in de Lighthouse-set. | — | `scripts/perf/netem-proxy.ts` (nieuw), `lighthouse.ts`, `lib.ts`, `package.json` |

## Kwaliteit en instellingen (AVIF q50 / WebP q72)

Vergeleken op echte foto's (Concept500-banners, 480 en 800 w) met een SSIM op luminantie en visueel
(uitsneden naast elkaar): AVIF q50 ≈ WebP q72 bij **55–65 % van de bytes** op gladde foto's; op
korrelige/gedetailleerde foto's (filmstill, CAD-tekening) scoort AVIF q50 iets lager op SSIM
(0,955 vs 0,966) maar visueel was er op weergavegrootte geen verschil (AVIF vlakt filmkorrel iets af).
WebP 800 w: q80 84 kB → q72 67 kB → AVIF q50 42 kB. De demo-artwork is vlak en synthetisch: daar wint
AVIF maar 10–30 % (card 7,9 → 5,5 kB); bij echte productfoto's is de winst groter.
AVIF effort 3 i.p.v. 4: 3× sneller (12 MP-foto, alle breedtes: 0,55 s i.p.v. 1,6 s) voor < 1 % grotere
bestanden. Upload van één foto kost nu ~1 s CPU i.p.v. ~0,3 s (bij 50 foto's per batch ~50 s).

## Wat al goed was (gecontroleerd)

- LCP-foto staat in de server-HTML, `fetchpriority=high`, niet lazy, `decoding=async`, preload als eerste
  element in `<head>`; geen client-component of hydration bepaalt de zichtbaarheid. De galerij is een
  client-component maar rendert de eerste foto server-side; geen carrousel die de eerste slide verbergt.
- Geen fade-in/opacity-transitie op een prioriteitsfoto (alleen `transform` bij hover en de statische
  `opacity-60` voor verkochte items). Render delay 11–29 ms (mobiel).
- Blur-placeholder: 24 px WebP (~150 bytes) inline als `background-image` op de `<img>`; Chrome negeert
  zulke low-entropy-achtergronden als LCP-kandidaat en hij vertraagt niets.
- Uploads-route: geen DB-werk per request voor publieke beelden (de "is dit product gevoelig"-check gaat
  via de data-cache uit ronde 1; alleen bij gevoelige producten volgt `currentUser()`), p50 ~1 ms lokaal;
  strong ETag + `304` op `If-None-Match`; `nosniff`, `default-src 'none'; sandbox`; de proxy (CSP-nonce)
  draait niet voor `/uploads`. `HEAD` werkt. Geen `Vary` nodig: elke variant heeft een eigen URL (geen
  content negotiation). Range-requests krijgen bewust een volledige `200` (toegestaan door de spec;
  browsers gebruiken geen ranges voor afbeeldingen).

## 103 Early Hints — onderzocht, niet ingebouwd

- **Next 16 (`next start`)** heeft geen API voor Early Hints: `writeEarlyHints` bestaat alleen als
  niet-geïmplementeerde stub in Next's mock-response. Next zet ook geen `Link`-header voor de preloads
  (React's `onHeaders` wordt in de dynamische render niet gebruikt; gecontroleerd: geen `Link`-header).
- **ingress-nginx** kan geen 103 genereren uit een upstream-`Link`-header (nginx heeft pas sinds 1.29 een
  `early_hints`-directive, ingress-nginx stelt die niet bloot en het project is in onderhoudsmodus).
- **Wat het zou opleveren**: een Early Hint helpt alleen de tijd tussen request en de eerste HTML-bytes,
  dus de server-denktijd (hier 7–17 ms TTFB server-side). De preload voor foto en font staat al op byte
  144 van het eerste HTML-chunk. Winst < 20 ms — niet de complexiteit (eigen server-wrapper of CDN met
  Early-Hints-cache zoals Cloudflare) waard. Bij een CDN met Early Hints-ondersteuning komt het gratis.

## Afwegingen en bewust níet gedaan

- **Opslag ×2**: per foto 7 WebP + 7 AVIF i.p.v. 3 WebP. Demo-uploads 15,6 → 30,7 MB. Telt mee in het
  tenantquotum (`storageQuotaGb`). Alternatief (minder breedtes) kost bytes bij bezoekers; opslag is goedkoper.
- **HTML iets groter**: `srcset` × 2 formaten, URL's staan ook in de RSC-payload. Gzip: home +2,4 kB,
  /shop +1,9 kB, categorie +0,9, product +0,4 (profielen beperken het aantal URL's per context; de
  galerij krijgt alleen de `wide`-breedtes als props).
- **Upload trager** (AVIF): ~1 s CPU per foto. Bij grote batches merkbaar; alternatief is AVIF in een
  achtergrondjob (pg-boss) — niet gedaan zolang uploads synchroon en per batch begrensd zijn (50).
- **Font-preload met `fetchpriority=low`** geprobeerd (pakketmodus): foto klaar tegelijk met het document
  (product LCP 893 → 813 ms), maar het font kwam pas na alle JS binnen (0,98 → 1,7 s) → zichtbare
  font-swap 0,7 s later, en home/shop/categorie veranderden niet (836/894/822 ms). Teruggedraaid.
- **Minder prioriteitskaarten op mobiel** (4 → 2 zichtbare): de tweede rij is op 390–412 px half in beeld
  en de kaarten zijn nu ~2 kB; winst < 20 ms, desktop zou erop achteruitgaan. Niet gedaan.
- **Restrisico (bestaand, niet nieuw)**: een product dat ná publicatie als gevoelig wordt gemarkeerd heeft
  publieke, een jaar immutable gecachete beeld-URL's in browsers/CDN's. De route weigert ze direct, maar
  bestaande caches niet. Oplossing zou zijn: beeld-keys roteren bij het aanzetten van `blurred`.

## Volgende hefboom (niet in deze ronde)

In de pakketmodus is de foto nu klaar zodra het **HTML-document** binnen is; het document is daarmee de
bottleneck voor foto-LCP op trage verbindingen. Elke 10 kB gzip HTML ≈ 50 ms bij 1,6 Mbit/s. De grootste
posten: de inline CSS staat twee keer in het document (`<style>` + RSC-payload, ~13,5 kB gzip ×2, ronde 2)
en de RSC-payload herhaalt de volledige kaart-markup op cataloguspagina's (/shop 67 kB gzip). Kortere
`/uploads`-URL's (bv. zonder tenant-/product-id-segmenten) zouden per kaart ook schelen.

## Opnieuw meten

```bash
# oude modus (devtools, 562 ms per request) — zoals ronde 2
npx next build && npx next start -p 3001
PERF_LH_THROTTLING=devtools PERF_LH_FORM_FACTORS=mobile npm run perf:lighthouse

# pakketmodus (realistisch, HTTP/2 + TLS): server op 3002, proxy op 3001
npx next start -p 3002
npm run perf:netem                                                     # mobiel profiel
PERF_LH_THROTTLING=packet PERF_LH_FORM_FACTORS=mobile npm run perf:lighthouse
PERF_NET_RTT=40 PERF_NET_DOWN_KBPS=10240 PERF_NET_UP_KBPS=10240 npm run perf:netem   # desktopprofiel
PERF_LH_THROTTLING=packet PERF_LH_FORM_FACTORS=desktop npm run perf:lighthouse

# bestaande uploads aanvullen (per omgeving één keer; idempotent)
npm run media:reprocess -- --tenant concept-militaria --dry-run
npm run media:reprocess -- --all
```

In productie draait `media:reprocess` waar ook de ETL draait (image `migrate`, met het uploads-volume
gemount en dezelfde `UPLOADS_DIR`). Het script schrijft alleen nieuwe bestanden en manifesten; de shop
pikt ze op na het verlopen van de data-cache (60 s) of de manifest-cache (60 s voor contentbeelden).
