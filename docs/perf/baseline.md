# Performance — nulmeting (baseline)

Gemeten op 2026-10-08 (nacht), vóór de wijzigingen uit [results.md](results.md). Productiebuild
(`next build` + `next start -p 3001`, demo-tenant `concept-militaria` via domein `localhost:3001`),
Postgres 18 in Docker (127.0.0.1:54329), alles lokaal op één MacBook (Apple Silicon). Data: demo-seed
(1.063 producten, 139 orders, 11k page views).

Herhalen: zie [results.md § Opnieuw meten](results.md#opnieuw-meten) (`npm run perf`, `npm run perf:lighthouse`).

## Methode

- **Server (TTFB / totaal)**: `scripts/perf/measure.ts` — per route 3 warm-up-requests en daarna 20
  sequentiële requests met `fetch` (TTFB = response headers binnen, totaal = volledige body). Warme
  data-cache (`unstable_cache`), zoals een drukke shop.
- **DB-queries per request**: `pg_stat_statements` in de dev-container (`shared_preload_libraries`,
  extensie in schema `perf_stats`), de server draait met een eigen DB-rol `qm_perf`; per route
  `pg_stat_statements_reset(rol)` → 20 requests → som van `calls` / 20 (BEGIN/COMMIT niet meegeteld).
- **HTML**: grootte van de response (raw en gzip).
- **JS**: alle `/_next/static/…js`-chunks waarnaar de HTML verwijst (script-tags + RSC-payload), gzip.
  Het `noModule`-polyfillbestand (38,5 kB gzip) wordt door moderne browsers niet geladen en is hieronder
  al afgetrokken.
- **Lighthouse 13** (lab, headless Chromium van Playwright): mobiel (gesimuleerde 4G + 4× CPU-throttling)
  en desktop, mediaan van 3 runs (op LCP). INP vraagt echte interactie; TBT is de lab-proxy.
- Admin: ingelogd als de seed-OWNER via het echte loginformulier (Playwright).

## Server, queries en bytes per route

| groep | route | pad | status | TTFB p50 (ms) | TTFB p95 | totaal p50 | totaal p95 | queries/req | HTML kB (gzip) | JS: bestanden, kB gzip |
|---|---|---|---|---|---|---|---|---|---|---|
| shop | home | `/` | 200 | 7.9 | 18.3 | 8.1 | 23.1 | 3¹ | 138.1 (20.0) | 9, 175.6 |
| shop | shop | `/shop` | 200 | 10.6 | 16.1 | 11.0 | 16.4 | 3 | 291.0 (33.0) | 10, 184.7 |
| shop | shop + filter | `/shop?f=period.ww1` | 200 | 10.1 | 24.4 | 10.3 | 24.8 | 3 | 141.1 (19.9) | 10, 184.7 |
| shop | shop + zoekterm | `/shop?q=helmet` | 200 | 8.8 | 13.0 | 9.0 | 13.3 | 3 | 131.6 (19.6) | 10, 184.7 |
| shop | categorie | `/shop/category/helmets` | 200 | 9.9 | 13.2 | 10.1 | 13.4 | 3 | 175.6 (22.5) | 10, 184.7 |
| shop | product | `/product/50212/…` | 200 | 6.3 | 9.6 | 6.6 | 10.0 | 6 | 104.0 (18.9) | 10, 193.9 |
| shop | CMS-pagina | `/shipping` | 200 | 6.4 | 13.1 | 6.6 | 13.2 | 2 | 62.7 (10.4) | 9, 175.6 |
| shop | 404 / redirect-lookup | `/this/does/not/exist` | 404 | 6.5 | 9.5 | 8.2 | 11.4 | 4 | 35.7 (7.3) | 9, 175.6 |
| shop | winkelwagen (1 item) | `/cart` | 200 | 6.3 | 8.6 | 11.9 | 19.2 | **30** | 91.3 (17.2) | 10, 184.7 |
| shop | checkout (1 item) | `/checkout` | 200 | 7.1 | 10.1 | 11.7 | 17.2 | **25** | 98.9 (18.2) | 10, 186.5 |
| admin | dashboard | `/admin/dashboard` | 200 | 8.2 | 10.6 | 16.1 | 21.1 | 18 | 130.7 (15.5) | 11, 197.9 |
| admin | voorraadlijst | `/admin/inventory` | 200 | 9.8 | 20.4 | 19.9 | 30.5 | 17 | 234.0 (22.2) | 11, 199.0 |
| admin | voorraad zoeken | `/admin/inventory?q=helmet` | 200 | 6.6 | 12.8 | 11.1 | 14.9 | 17 | 113.0 (14.4) | 11, 199.0 |
| admin | product bewerken | `/admin/inventory/[id]` | 200 | 8.4 | 9.6 | 15.7 | 19.4 | 35 | 180.1 (23.1) | 13, 216.6 |
| admin | orders | `/admin/orders` | 200 | 5.0 | 9.2 | 7.7 | 12.8 | 8 | 99.7 (11.7) | 11, 198.8 |
| admin | orderdetail | `/admin/orders/[id]` | 200 | 7.6 | 9.4 | 13.7 | 15.5 | 14 | 117.0 (15.1) | 11, 198.9 |
| admin | klanten | `/admin/customers` | 200 | 8.9 | 14.0 | 11.1 | 14.2 | 5 | 126.7 (13.2) | 10, 190.7 |
| admin | klantdetail | `/admin/customers/[id]` | 200 | 8.0 | 11.5 | 9.0 | 15.7 | 7 | 89.7 (12.6) | 11, 196.9 |
| admin | instellingen | `/admin/settings/general` | 200 | 7.3 | 12.5 | 7.6 | 12.7 | 5 | 78.3 (13.4) | 11, 200.3 |

¹ De eerste run gaf 8,7: prefetch-requests van een nog openstaande admin-tab in het meetscript telden
mee (sessions/users/customers-queries). Script daarna gerepareerd; de echte waarde is 3 (tenant-domein,
tenant, live reserveringen).

Server-side is alles lokaal snel (TTFB p50 5–11 ms). Let op: lokaal kost een DB-roundtrip ~0,05 ms; in
productie (managed Postgres, ander netwerk) eerder 0,5–2 ms per query. Het aantal queries per request is
daarom de belangrijkste server-metriek.

### Zoeken

`/shop?q=…` (warme cache): `helmet` 8,9 ms, `iron cross` 7,5 ms, `1944` 8,4 ms, `stahlhelm m35` 6,8 ms,
`xyzzy` 6,7 ms (TTFB p50), 2–3 queries. Resultaten komen uit de data-cache; de SQL zelf draait alleen bij
een cache-miss (per tenant + zoekterm, 60 s).

## Lighthouse (mediaan van 3)

| pagina | vorm | score | FCP (ms) | LCP (ms) | CLS | TBT (ms) | Speed Index | transfer (kB) | JS (kB) |
|---|---|---|---|---|---|---|---|---|---|
| home | mobiel | 94 | 1668 | 2933 | 0.033 | 8 | 1668 | 434 | 179 |
| home | desktop | 100 | 456 | 698 | 0 | 0 | 456 | 428 | 179 |
| shop | mobiel | 95 | 1215 | 2957 | 0 | 17 | 1215 | 515 | 189 |
| shop | desktop | 100 | 412 | 690 | 0 | 0 | 412 | 486 | 189 |
| shop + q | mobiel | 93 | 1663 | 3170 | 0 | 16 | 1663 | 356 | 189 |
| shop + q | desktop | 100 | 410 | 651 | 0 | 0 | 410 | 409 | 189 |
| product | mobiel | 93 | 1660 | 3086 | 0 | 13 | 1660 | 378 | 198 |
| product | desktop | 100 | 415 | 633 | 0 | 0 | 415 | 411 | 198 |
| CMS-pagina | mobiel | 97 | 1372 | 2565 | 0 | 9 | 1372 | 287 | 179 |
| CMS-pagina | desktop | 100 | 373 | 528 | 0 | 0 | 373 | 361 | 179 |
| admin dashboard | mobiel | 87 | 1060 | 4006 | 0.021 | 12 | 1324 | 477 | 216 |
| admin dashboard | desktop | 99 | 290 | 841 | 0.009 | 0 | 290 | 665 | 318 |
| admin voorraad | mobiel | 85 | 1092 | 4337 | 0 | 40 | 2047 | 572 | 211 |
| admin voorraad | desktop | 99 | 292 | 837 | 0 | 0 | 292 | 782 | 318 |

(Desktop-admin laadt meer JS doordat de zijbalk-links in beeld zijn en Next hun route-chunks prefetcht.)

## Bevindingen

1. **Render-blocking CSS in de shop (grootste LCP-post).** Elke shoppagina laadde twee stylesheets van
   elk ~17 kB gzip: `globals.css` (alle drie de admin-thema's + Tailwind-utilities van de héle app, 87 kB
   raw) via de root-layout, plús `shop.css`. Lighthouse: "render-blocking requests, est. savings 840 ms"
   (mobiel). De shop gebruikt niets uit `globals.css` behalve de Tailwind-preflight.
2. **zod in elke client-bundle.** `src/components/ZodJitless.tsx` (root-layout) importeerde `zod` voor
   één config-regel: 31 kB gzip (87 % ongebruikt volgens Lighthouse) op elke shop- én adminpagina.
3. **Winkelwagen/checkout: dubbel werk.** De cart-pagina las de cart 3× (`getCart` in de pagina, in
   `getCheckoutContext` en in `quoteCheckout`; elk 6 queries door Prisma's aparte relatie-queries), de
   tenant-valuta 4× en de verzendzones 2×. Checkout idem.
4. **Tenant-resolutie: 2 queries per request** (`tenantDomain.findUnique({ include: { tenant } })` =
   twee roundtrips) op elke shop- en adminpagina.
5. **Productpagina**: verzendindicatie ("Shipping to … from …") las verzendzones + tarieven live (2
   queries per view), terwijl die voor iedere bezoeker gelijk zijn.
6. **Afbeeldingen**: elke `/uploads/…/products/…`-request doet een query (is het product
   "blurred"?). Een catalogusweergave met 24 kaarten = 24+ queries bij een koude browsercache.
7. **Zoeken zonder index**: `ILIKE '%woord%'` op title/description/sku, géén pg_trgm (de migratie
   noemde het als "later"). Op de demo-data onmerkbaar; op schaal (zie hieronder) 20–55 ms per zoekactie.
8. **Admin**: queries zijn goed geparalleliseerd (Promise.all, `cache()`); traagste statement is de
   dashboard-analytics over `page_views` (10 ms + 6 ms + 2 ms bij 11k rijen, lineair in het aantal
   page views — zie aanbevelingen). Admin-mobiel-LCP (4 s) wordt vooral bepaald door 12 gepreloade
   fontbestanden (176 kB) die concurreren met CSS/JS.
9. **Fonts shop**: `next/font` declareert alle 24 allowlist-families (`preload: false`): 47 kB raw CSS
   aan `@font-face`, maar alleen de gebruikte bestanden worden gedownload. OK.
10. **Proxy** (`src/proxy.ts`): alleen nonce + CSP-string, geen DB — verwaarloosbaar.
11. **Compressie**: `next start` gzipt zelf (ook statische chunks, per request); `_next/static` heeft
    `immutable`-caching. Productafbeeldingen ook immutable; CMS-afbeeldingen 5 min.

### Traagste statements (pg_stat_statements, `mean_exec_time`)

| ms (gem.) | waar | statement |
|---|---|---|
| 10.0 | admin dashboard | top-pagina's: `split_part(path)`, `COUNT(DISTINCT visitorHash)` over 30 dagen `page_views` |
| 6.1 | admin dashboard | dagreeks page views/bezoekers |
| 2.0 | admin dashboard | top-referrers |
| 0.71 | admin voorraad | `product_images` voor de lijst |
| 0.60 | admin klanten | klantenlijst met order-aggregaten |
| 0.42 | admin voorraad | statustellers (`count(*) FILTER …`) |
| ≤ 0.2 | overal | alle overige (PK/unique-lookups) |

### Zoeken op schaal (EXPLAIN ANALYZE, synthetische tabel)

Kopie van `products` ×100 (106.300 rijen, één tenant) in een scratch-database:

| zoekopdracht | zonder pg_trgm | met pg_trgm (GIN op title/description/sku) |
|---|---|---|
| `helmet` (title/sku) | 20,2 ms | 1,7 ms |
| `stahlhelm` (title/description/sku) | 38,9 ms | 0,7 ms |
| `xyzzy` (geen treffers) | 53,3 ms | 0,04 ms |

Bij ~10k producten per tenant is het verschil klein (0,6–1,6 ms vs 0,07–1,5 ms); de index loont vanaf
tienduizenden producten (archief met verkochte items, admin-zoeken over alle statussen).
