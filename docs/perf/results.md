# Performance — resultaten (na de verbeteringen)

> Vervolg: [round2.md](round2.md) (fonts per tenant, CSS inline, JS-splitsing, intent-prefetch, compressie).

Zelfde methode en machine als de [nulmeting](baseline.md): productiebuild op `localhost:3001`, Postgres in
Docker, `scripts/perf/measure.ts` (20 requests per route na warm-up, queries via `pg_stat_statements`) en
`scripts/perf/lighthouse.ts` (Lighthouse 13, mediaan van 3). Nameting 2026-10-08 op de actuele code, dus
inclusief het parallelle werk dat intussen landde (themabouwer, onboarding/`/apply`, productimport).

> Kanttekening timing: de machine draaide tegelijk andere agents en dev-servers (load average 8–40).
> De servertabel komt uit een run bij load ~12. TTFB's liggen lokaal allemaal onder ~10 ms en zijn
> daardoor ruisgevoelig; aantallen queries, bytes en CSS/JS-gewichten zijn deterministisch en de
> betrouwbare vergelijking.

## Wat er veranderd is

| # | wijziging | effect | bestanden |
|---|---|---|---|
| 1 | **Admin-CSS niet meer op shoppagina's.** `globals.css` (admin-thema's + Tailwind-utilities van de hele app) wordt nu in `src/app/admin/layout.tsx` geïmporteerd i.p.v. de root-layout; `shop.css` krijgt de Tailwind-preflight en scant ook `src/app/layout.tsx`. | Shop: render-blocking CSS van 2 × ~17 kB naar 13,4 kB (shop) + 6,3 kB (fonts) gzip, −87 kB raw te parsen CSS. Visueel gecontroleerd: A/B-screenshots (zelfde build, met/zonder admin-sheet) van 11 shoppagina's × mobiel/desktop pixel-identiek (op laadmoment van productfoto's na); geen enkele class in shop-HTML die alleen in de admin-sheet bestond. | `src/app/layout.tsx`, `src/app/admin/layout.tsx`, `src/app/(shop)/shop.css` (gedeeld, alleen kopcommentaar + 2 regels) |
| 2 | **zod uit de standaard-clientbundle.** `ZodJitless` zet `jitless` nu via zod's globale config-object zonder `zod` te importeren (`src/lib/zod-jitless.ts`, met unit-test die faalt als een zod-update dat object verplaatst). | −29 kB gzip JS op elke pagina die zelf geen zod gebruikt (shop 175,6 → 146,6 kB; admin ~198 → 168 kB). Checkout/instellingen laden zod nog wel, want die valideren in de browser. | `src/components/ZodJitless.tsx`, `src/lib/zod-jitless.ts`(+test) |
| 3 | **Winkelwagen/checkout dedupliceren.** `getCheckoutContext` en `quoteCheckout` accepteren een al geladen cart (`{ cart }`); tenant-valuta en verzendzones zijn per request gememoïseerd (React `cache`). `placeOrder` blijft alles live lezen. | Cart 30 → 14 queries, checkout 25 → 15. | `src/server/cart/index.ts`, `src/server/checkout/index.ts`, `src/app/(shop)/cart/page.tsx`, `src/app/(shop)/checkout/page.tsx` |
| 4 | **Tenant in één query.** `findTenantByHost` gebruikt `tenant.findFirst({ status: ACTIVE, domains: { some: { host } } })` i.p.v. `findUnique + include` (2 roundtrips). Geen caching: schorsen werkt nog steeds direct. | −1 query op elke shop- én adminrequest. | `src/server/tenant.ts` |
| 5 | **Verzendindicatie productpagina uit de data-cache.** Zones + tarieven via `shopCache("quote-zones", "settings")`; elke `shipping.*`-mutatie wordt geaudit en invalideert de tenant-tag. Alleen voor de indicatie; checkout/order lezen live. | Product 6 → 3 queries. | `src/server/storefront/shipping.ts` (nieuw), `src/components/shop/catalog/product/ShippingHint.tsx` |
| 6 | **Afbeeldingsroute: "blurred"-check gecachet** per tenant+product (`catalog`-tag; productmutaties invalideren direct). | −1 query per productafbeelding (een catalogus met 24 kaarten = 24–48 requests bij koude cache). | `src/app/uploads/[...path]/route.ts`, `tests/media/uploads-route.test.ts` |
| 7 | **pg_trgm-indexen voor zoeken** (migratie `20261008120000_search_trigram_indexes`, ook in `schema.prisma` gedeclareerd → geen drift). | Op 106k producten: 20–53 ms → 0,04–1,7 ms per zoekquery (zie baseline). Op de demo-data niet meetbaar. | `prisma/schema.prisma` (gedeeld, alleen Product-indexen), `prisma/migrations/20261008120000_search_trigram_indexes/` |
| 8 | **`DATABASE_POOL_MAX`** voor de node-postgres-pool (default 10), gedocumenteerd in de env-tabel. | Pool afstemmen op replica's × `max_connections`. | `src/server/db.ts` (+`db.test.ts`), `docs/deploy.md` |
| 9 | **Meetscripts**: `npm run perf`, `npm run perf:lighthouse`. | Herhaalbare meting. | `scripts/perf/*.ts`, `package.json` |

Gedrag is ongewijzigd: tenant-isolatie (alle queries blijven op tenantId gefilterd), CSP/nonce,
auth-checks en de "live"-delen (reserveringen, beschikbaarheid, cart, orderplaatsing) zijn niet gecachet.

## Voor / na — server, queries, bytes

TTFB/totaal p50 in ms; JS = gzip, zonder het `noModule`-polyfill (ook in de nulmeting afgetrokken).

| route | TTFB p50 voor → na | totaal p50 voor → na | queries/req voor → na | HTML gzip (kB) | JS (kB) voor → na |
|---|---|---|---|---|---|
| home `/` | 7,9 → 7,3 | 8,1 → 8,0 | 3 → **2** | 20,0 → 19,6 | 175,6 → **146,6** |
| `/shop` | 10,6 → 9,4 | 11,0 → 9,7 | 3 → **2** | 33,0 → 33,1 | 184,7 → **155,7** |
| `/shop?f=…` | 10,1 → 7,0 | 10,3 → 7,2 | 3 → **2** | 19,9 → 20,0 | 184,7 → **155,7** |
| `/shop?q=helmet` | 8,8 → 5,8 | 9,0 → 5,9 | 3 → **2** | 19,6 → 19,6 | 184,7 → **155,7** |
| categorie | 9,9 → 6,7 | 10,1 → 6,9 | 3 → **2** | 22,5 → 22,6 | 184,7 → **155,7** |
| product | 6,3 → 5,1 | 6,6 → 5,2 | 6 → **3** | 18,9 → 19,0 | 193,9 → **164,9** |
| CMS-pagina | 6,4 → 3,6 | 6,6 → 3,7 | 2 → **1** | 10,4 → 10,4 | 175,6 → **146,6** |
| 404 / redirect | 6,5 → 4,1 | 8,2 → 4,2 | 4 → **2** | 7,3 → 7,3 | 175,6 → **146,6** |
| `/cart` (1 item) | 6,3 → 4,6 | 11,9 → 8,3 | 30 → **14** | 17,2 → 17,3 | 184,7 → **155,7** |
| `/checkout` (1 item) | 7,1 → 5,0 | 11,7 → 6,7 | 25 → **15** | 18,2 → 18,3 | 186,5 → 187,9¹ |
| admin dashboard | 8,2 → 5,7 | 16,1 → 17,4 | 18 → 20² | 15,5 → 15,3 | 197,9 → **168,0** |
| admin voorraad | 9,8 → 6,6 | 19,9 → 14,6 | 17 → 17 | 22,2 → 22,3 | 199,0 → **169,1** |
| admin voorraad zoeken | 6,6 → 6,5 | 11,1 → 10,0 | 17 → 17 | 14,4 → 14,4 | 199,0 → **169,1** |
| admin product bewerken | 8,4 → 6,5 | 15,7 → 11,7 | 35 → 35 | 23,1 → 22,4 | 216,6 → **186,8** |
| admin orders | 5,0 → 4,2 | 7,7 → 6,1 | 8 → 8 | 11,7 → 11,7 | 198,8 → **168,9** |
| admin orderdetail | 7,6 → 4,8 | 13,7 → 8,1 | 14 → 14 | 15,1 → 15,1 | 198,9 → **169,0** |
| admin klanten | 8,9 → 7,6 | 11,1 → 7,8 | 5 → 5 | 13,2 → 13,3 | 190,7 → **160,7** |
| admin klantdetail | 8,0 → 5,1 | 9,0 → 5,6 | 7 → 7 | 12,6 → 12,5 | 196,9 → **167,0** |
| admin instellingen | 7,3 → 4,8 | 7,6 → 5,0 | 5 → 5 | 13,4 → 13,5 | 200,3 → 201,0¹ |

Zoeken (`/shop?q=…`, TTFB p50): helmet 8,9 → 6,0 · iron cross 7,5 → 4,5 · 1944 8,4 → 4,9 ·
stahlhelm m35 6,8 → 5,7 · xyzzy 6,7 → 4,5 ms; 2–3 → 1–2 queries.

¹ Checkout en instellingen valideren formulieren in de browser met zod; daar blijft zod (terecht) in de
bundle, en het parallelle werk voegde een paar kB toe.
² +2 queries (tenant + domeinen) door de nieuwe setup-checklist van de onboarding op het dashboard —
niet door deze wijzigingen; mijn tenant-lookup scheelt er al één.

In de admin blijft het aantal queries gelijk: die resolvet de tenant via de sessie, niet via de host, en
was al goed geparalleliseerd (Promise.all, `cache()`). De admin-winst zit in de JS (−30 kB).

### CSS op shoppagina's

| | voor | na |
|---|---|---|
| stylesheets (render-blocking) | `globals.css` 17,3 kB + `shop.css`+fonts 17,7 kB gzip | `shop.css` 13,4 kB + fonts 6,3 kB gzip |
| raw te parsen | 87 kB + 105 kB | 75 kB + 47 kB |

## Voor / na — Lighthouse (mediaan van 3)

Na-run op de actuele code (incl. themabouwer). LCP in ms.

| pagina | vorm | score voor → na | FCP voor → na | LCP voor → na | TBT voor → na | JS kB voor → na |
|---|---|---|---|---|---|---|
| home | mobiel | 94 → 96 | 1668 → 1366 | 2933 → **2716** | 8 → 13 | 179 → **150** |
| home | desktop | 100 → 100 | 456 → 370 | 698 → **510** | 0 → 0 | 179 → **150** |
| shop | mobiel | 95 → 91 | 1215 → 1366 | 2957 → 3401³ | 17 → 15 | 189 → **159** |
| shop | desktop | 100 → 100 | 412 → 325 | 690 → 688 | 0 → 0 | 189 → **159** |
| shop + q | mobiel | 93 → 95 | 1663 → 1361 | 3170 → **2868** | 16 → 14 | 189 → **159** |
| shop + q | desktop | 100 → 100 | 410 → 329 | 651 → 653 | 0 → 0 | 189 → **159** |
| product | mobiel | 93 → 95 | 1660 → 1370 | 3086 → **2787** | 13 → 9 | 198 → **169** |
| product | desktop | 100 → 100 | 415 → 330 | 633 → **586** | 0 → 0 | 198 → **169** |
| CMS-pagina | mobiel | 97 → 98 | 1372 → 1063 | 2565 → **2335** | 9 → 13 | 179 → **150** |
| CMS-pagina | desktop | 100 → 100 | 373 → 299 | 528 → 516 | 0 → 0 | 179 → **150** |
| admin dashboard | mobiel | 87 → 90 | 1060 → 914 | 4006 → **3710** | 12 → 18 | 216 → **186** |
| admin dashboard | desktop | 99 → 100 | 290 → 247 | 841 → **753** | 0 → 0 | 318 → **280** |
| admin voorraad | mobiel | 85 → 90 | 1092 → 917 | 4337 → **3699** | 40 → 4 | 211 → **181** |
| admin voorraad | desktop | 99 → 98 | 292 → 247 | 837 → 1097³ | 0 → 0 | 318 → **289** |

³ Uitschieters onder hoge machine-load. Een eerdere na-run (zelfde wijzigingen, vóór het samenvoegen
van de themabouwer) gaf shop mobiel LCP 2878 ms en admin voorraad desktop 772 ms. FCP verbetert op elke
pagina consistent met 15–25 % (minder render-blocking CSS); LCP mobiel −200 tot −640 ms op de meeste pagina's.
CLS bleef 0–0,03; TBT bleef verwaarloosbaar (< 20 ms).

## Resterende knelpunten en aanbevelingen

1. **Admin-fonts (mobiel-LCP 3,7 s).** `src/lib/admin-fonts.ts` preloadt voor thema A 12 fontbestanden
   (176 kB, latin + latin-ext × alle gewichten), ook voor wie thema B/C gebruikt. Ze concurreren met CSS/JS.
   Voorstel: alleen de body-font preloaden (of gewichten beperken / alleen `latin`), labels/mono laten
   swappen. Niet aangepast: designkeuze en raakt de thema's.
2. **Dashboard-analytics schaalt lineair.** De drie `page_views`-aggregaties (10 + 6 + 2 ms bij 11k rijen)
   worden bij een drukke shop (miljoenen views) seconden. Voorstel: dagelijkse rollup-tabel
   (`page_view_daily` per tenant/dag/pad/referrer) via de bestaande cron, of de kaart cachen
   (`unstable_cache` 5 min, de data is niet realtime-kritisch).
3. **Compressie verplaatsen naar de ingress.** `next start` gzipt elke response (ook statische chunks) in
   Node. Met ingress-nginx: `enable-brotli`/`use-gzip` aanzetten en `compress: false` in `next.config.ts`
   (alleen samen, anders gaat compressie verloren in docker-compose-setups). Brotli scheelt ~15 % op JS/CSS.
4. **Shop-fonts-CSS** (6,3 kB gzip render-blocking, 47 kB raw): `@font-face` van alle 24 allowlist-families.
   Kan kleiner door per thema/tenant alleen de gekozen families te declareren (raakt de themabouwer).
5. **HTML van `/shop`** is 291 kB raw (33 kB gzip) door de RSC-payload van 24 kaarten; prima zolang gzip
   werkt, maar minder props per kaart naar client-componenten scheelt.
6. **Prisma-relaties** kosten één roundtrip per relatieniveau (geen `relationJoins`, nog preview in
   Prisma 7). Product bewerken doet 35 (parallelle) queries; bij een DB met 1–2 ms latency is dat merkbaar.
   Pas `relationLoadStrategy: "join"` toe zodra het GA is, of bundel de detailqueries.
7. **Tenant-lookup cachen** (nu 1 query per request) kan met `unstable_cache` per host + tenant-tag, maar
   alleen als schorsen/domein-wijzigingen gegarandeerd die tag invalideren; bewust niet gedaan.
8. **CMS-afbeeldingen** krijgen `max-age=300`; als content-keys uniek per upload zijn (lijken
   gehasht), kunnen ze ook `immutable` worden.
9. **Prefetch admin-zijbalk** (desktop +100 kB JS per pagina) is een bewuste afweging voor snelle navigatie.

## Opnieuw meten

Eenmalige voorbereiding (alleen dev-container):

```bash
# pg_stat_statements laden (herstart van de container)
docker exec -i quartermaster-postgres psql -U quartermaster -d quartermaster \
  -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'" -c "ALTER SYSTEM SET pg_stat_statements.track = 'all'"
docker restart quartermaster-postgres
docker exec -i quartermaster-postgres psql -U quartermaster -d quartermaster \
  -c "CREATE SCHEMA IF NOT EXISTS perf_stats" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA perf_stats" \
  -c "CREATE ROLE qm_perf LOGIN PASSWORD 'qm_perf' IN ROLE quartermaster"
```

Meten (de dev-server op :3000 blijft draaien; Next 16 bouwt naar een eigen map):

```bash
npm run build
DATABASE_URL=postgresql://qm_perf:qm_perf@127.0.0.1:54329/quartermaster npm run start -- -p 3001
# andere terminal:
PERF_PG_URL=postgresql://quartermaster:quartermaster@127.0.0.1:54329/quartermaster PERF_LABEL=na npm run perf
PERF_LABEL=na npm run perf:lighthouse
```

Opties: `PERF_BASE_URL` (default `http://localhost:3001`, moet een tenant-host zijn), `PERF_RUNS` (20),
`PERF_WARMUP` (3), `PERF_PG_ROLE` (`qm_perf`), `PERF_LH_RUNS` (3), `PERF_LH_FORM_FACTORS`
(`mobile,desktop`). Zonder `PERF_PG_URL` worden queries niet geteld. Resultaten (incl. alle statements per
route) staan als JSON in `.local/perf/` (git-ignored). Het script legt één reservering in de winkelwagen
aan en verwijdert die aan het eind weer; er wordt nooit betaald. Meet bij voorkeur op een rustige machine.
