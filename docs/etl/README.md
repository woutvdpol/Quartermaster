# ETL Concept500 → Quartermaster (fase 4)

Code: `scripts/etl/` (TypeScript, tsx). Leest de legacy-MariaDB met `mysql2` (platte SQL per tabel, zie
`scripts/etl/legacy/readers.ts`) en schrijft via Prisma direct in Postgres. De overige bestanden in deze map
beschrijven per domein wat wel/niet gemigreerd wordt; dit document is de handleiding.

## Draaien

```bash
# legacy-dump lokaal: docker container qm-legacy-dump (127.0.0.1:33307, db "main")
export LEGACY_DATABASE_URL="mysql://root:<wachtwoord>@127.0.0.1:33307/main"
# DATABASE_URL (doel) komt uit .env

npm run etl -- --tenant concept500-import --domain import.localhost:3000 --dry-run
npm run etl -- --tenant concept500-import --domain import.localhost:3000 --legacy-host www.oude-shop.nl
```

| Optie | Betekenis |
|---|---|
| `--tenant <slug>` | Doel-tenant. Bestaat hij niet, dan wordt hij aangemaakt (vereist `--domain`), met standaard-settings. |
| `--domain <host>` | Primair domein voor een nieuwe tenant (wordt ook toegevoegd aan een bestaande als het ontbreekt). |
| `--name <naam>` | Naam nieuwe tenant (standaard legacy `shop_name`). |
| `--dry-run` | Alles in **één transactie** die aan het eind wordt teruggedraaid. Het rapport toont exact wat een echte run tegen de huidige doel-DB zou doen; er wordt niets geschreven en niets gedownload. |
| `--only <stap,…>` | Alleen deze stappen: `settings, categories, tags, purchasing, products, images, facets, shipping, payments, users, orders, content, newsletter, redirects, sequences`. Stappen lezen benodigde koppelingen uit de doel-DB, dus losse stappen werken na een eerdere volledige run. |
| `--skip-images` | Nooit foto's downloaden (alleen placeholders). |
| `--report <pad>` | Rapportbestand; standaard `.local/etl-report-<tijdstempel>.md` (`.local/` staat in `.gitignore`). |
| `--legacy-host <host,…>` | Hostnamen van de oude shop: absolute links daarnaar in content/menu's worden relatief. Zonder deze optie gelden absolute URL's met een bekend legacy-pad als intern. |
| `--zone-countries "Regio=NL,BE;Andere=*"` | Landen per legacy-verzendregio (anders afgeleid uit de orders van die regio). |
| `--facet-map <csv>` | Mappingbestand tags → facetten (zie `facets.md`). |
| `--force` | Toestaan dat de tenant al producten heeft die níet door de ETL zijn gemaakt. **Niet gebruiken op de demo-tenants.** |

Env: `LEGACY_DATABASE_URL` (verplicht), `DATABASE_URL` (doel), `LEGACY_CF_ACCOUNT_HASH` (optioneel, foto-download).

**Beveiliging:** een bestaande tenant met niet-ETL-producten (bijv. `concept-militaria`, `veldpost-antiek`) wordt
geweigerd. ETL-rijen herkent de ETL aan `legacyData.etl = "concept500"` (producten, orders).

## Transacties en idempotentie

- **Echte run:** tenant-stap en elke stap in een eigen transactie (commit per stap). Elke stap is idempotent, dus
  een afgebroken run kun je gewoon opnieuw starten. Foto-downloads lopen ná de images-stap, buiten de transactie,
  per foto gecommit (hervat waar hij stopte).
- **Dry-run:** alle stappen in één transactie + rollback (geen scratch-DB nodig, ziet de echte doelsituatie).
- Upsert-sleutels: `Category/Tag/Supplier/PurchaseRecord/ContentPage.legacyId`, `Product.stockCode` (= legacy
  `products.id`, besluit 26), `Order.number` (= `orders.id`), `User/Customer/NewsletterSubscriber` op
  (tenant, e-mail lower-case), `ShippingZone` op naam, `ShippingRate` op (zone, gewicht), `ProductImage` op
  (product, `legacyCloudflareId`), `Redirect` op (tenant, `fromPath`), campagnes op (onderwerp, aanmaakdatum).
- Kindrijen worden per run opnieuw opgebouwd: orderregels/-adressen/betalingen/ETL-events van ETL-orders, de
  blokken van geïmporteerde CMS-pagina's. Menu's worden alleen geïmporteerd als de tenant nog géén menu's heeft.
- Wachtwoorden die na migratie al naar scrypt zijn herhasht worden nooit overschreven.
- `TenantSequence` `product.stockCode` en `order.number` gaan naar `max(...)` (nooit terug). `invoice.number` blijft
  leeg (eerste factuur = 1).
- Getest: drie opeenvolgende runs op de testdump geven identieke aantallen; run 2+ meldt alles als "ongewijzigd".

## Procedure dry-run → cutover

1. Productiedump in een MariaDB-container laden; `LEGACY_DATABASE_URL` zetten.
2. `--dry-run` op de doelomgeving; rapport doorlopen (aantallen, omzet, waarschuwingen, slug-botsingen,
   verzendregio's, staff-accounts). Zo nodig `--zone-countries`, `--legacy-host`, `--facet-map` toevoegen.
3. Echte run naar een **nieuwe** tenant (bijv. `concept500-import`) en controleren in admin + shop.
   Herhalen tot het rapport schoon is (idempotent).
4. Cutover: oude shop in onderhoud (freeze) → nieuwe dump → laatste echte run (zelfde tenant) → foto-download
   (`LEGACY_CF_ACCOUNT_HASH`, zonder `--skip-images`) → controle → Mollie-sleutels + webhook instellen → DNS/domein.
5. Na de run handmatig: verzendzones (landen!), Mollie, Matomo-URL, logo/banner opnieuw uploaden, bedrijfsgegevens
   (KvK/btw/IBAN), concept-systeempagina's (About/Contact) vullen of publiceren.

Storefront-cache: vanuit het CLI-proces kan de Next-cache niet worden geïnvalideerd; die verloopt binnen 60 s.

## Wat wordt gemigreerd

| Legacy | Quartermaster | Opmerkingen |
|---|---|---|
| `settings` (+ `currencies`) | `Setting`-groepen, `Tenant.currency/timezone` | via `LEGACY_KEY_MAP`/`DROPPED_LEGACY_KEYS` (`src/server/settings/schema.ts`); waarden per groep door het Zod-schema gevalideerd; ongeldige keys blijven standaard (gemeld). Valuta's → `general.displayCurrencies`. |
| `categories` | `Category` | boom in 2e pass; slugs genormaliseerd + uniek. |
| `tags`, `product_tag` | `Tag`, `ProductTag` | dubbele pivots samengevoegd; dubbele namen krijgen suffix. |
| — | standaard-`Facet`s + waarden | zoals `seedDefaultFacets`; optioneel tags → facetwaarden via `--facet-map` (tags blijven bestaan). |
| `product_origins`, `purchase_records` | `Supplier`, `PurchaseRecord` | `purchasedAt` = `created_at` (geen datumkolom in legacy). |
| `products` | `Product` (+ `StockMovement` ADJUSTMENT "ETL opening balance") | zie status hieronder; `publishedAt` = legacy `updated_at` (listingdatum), `soldAt`, vlaggen, specs → `[{label,value}]`, SKU '' → null en duplicaten geleegd, restvelden in `legacyData` (`active`, `stockControl`, `productId`, `photoCount`, `productReservedOn`, `legacySlug`). |
| `products.photos` | `ProductImage` | dubbel JSON gedecodeerd; volgorde = `sortOrder` (0 = hoofdfoto). Zonder download: placeholder-rij (`legacyCloudflareId`, `processedAt` null, `storageKey …/cf-<id>.pending`). |
| `related_products` | `ProductRelation` | zelfverwijzingen overgeslagen. |
| `regions/weights/region_weights` | `ShippingZone` + `ShippingRate` | tarief decimal € → centen; "Pickup…" → `isPickup`; landen uit `--zone-countries` of afgeleid uit orders (controleren!); zone zonder land → inactief. |
| `payment_methods` | — | alleen Mollie (besluit 16); toeslag-% alleen gebruikt om toeslagen in oude totalen te herkennen. |
| `users` + spatie-rollen | `User` (OWNER of CUSTOMER) + `Customer` + `Address` + `WishlistItem` | `admin`/`owner` → OWNER; wachtwoord als `bcrypt$<originele hash>` (verificatie + herhash bij login in `src/server/auth`). `birth_date` niet (AVG). |
| `orders` + `order_details` | `Order`, `OrderLine`, `OrderAddress` (SHIPPING + kopie BILLING), `Payment`, `OrderEvent` | zie hieronder. Klant per lower-case e-mail ("virtuele klant"), gekoppeld aan de user-klant via `customer_id`. |
| `content_pages` + `content_blocks` | `ContentPage` + `ContentBlock` | per type naar `data`-JSON, gevalideerd met `parseBlock`; `EMAILER` → `NEWSLETTER_SIGNUP`; `home` → systeempagina HOME; gereserveerde slugs krijgen suffix. |
| `contents` (ShopPageEnum) | systeempagina's TERMS/PRIVACY/CONTACT/ABOUT, pagina's `news`/`events`/`links` | items → TEXT-blokken (HTML → Markdown); gepubliceerd volgens de legacy-toggle; BANNER niet. Ontbrekende systeempagina's als concept met startblokken. |
| `menu_items` | `MenuItem` | links relatief + naar `pageId`/`qm:route:`/`qm:category:`; seed-bug (footer-items onder header "Contact") hersteld. |
| `emailer_subscribers` | `NewsletterSubscriber` | active → `confirmedAt`; unsubscribed → `unsubscribedAt`; pending alleen indien < 30 dagen oud. IP en codes niet. |
| `emailer_mails` | `NewsletterCampaign` | `sent_at` → SENT + tellers, anders DRAFT. |
| oude URL's | `Redirect` (source LEGACY, 301) | alleen paden die de redirect-runtime niet zelf afhandelt (zie hieronder). |

**Niet** gemigreerd: winkelmandjes, reserveringen, wachtwoord-resettokens, spatie-permissies, jobs, `import_log`,
legacy-valutakoersen, Turnstile-sleutels, contactformulier-berichten (nooit opgeslagen), facturen (bestonden niet),
biedingen/kortingscodes/leads/alerts/certificaten/documenten (nieuwe functies), Cloudflare-afbeeldingen van
settings (logo/banner/cta) en content-blokken (opnieuw uploaden).

### Productstatus (afgeleid)
`active = ARCHIVED` → ARCHIVED · `INACTIVE` → DRAFT · qty 0 + `SOLD` → SOLD · qty 0 + `STOLEN` → STOLEN ·
qty 0 + `RESERVED` → RESERVED (legacy toonde uitverkochte items als "Reserved") · qty 0 + `NOT_IN_SHOP` → ARCHIVED ·
anders ACTIVE. De tijdelijke mandreservering (`product_reserved_on`) wordt genegeerd (staat in `legacyData`).

### Orders
- **Betaalstatus:** `paid` → PAID; `manual` → PENDING (onbetaalde overschrijving, geen omzet), **behalve** als
  `order_paid_on` gezet is → PAID (`legacyData.paidInferred`; de oude admin verborg dan de "Paid"-knop);
  `failed` → FAILED.
- **Regelprijzen:** `order_details.price` is een afgerond regeltotaal in hele euro's. Reconstructie uit
  `orders.total − delivery`: (1) huidige productprijzen als die exact optellen, (2) idem plus toeslag-% van de
  betaalmethode, (3) anders naar verhouding van de afgeronde bedragen (largest remainder, centen exact).
  Altijd `priceReconstructed = true`; methode + afrondingsverschil in `legacyData.priceReconstruction`.
  Invariant: `subtotal − discountTotal + shippingTotal + surchargeTotal = total`.
- **Zonder regels** (testorders/afgebroken flows) → `archivedAt` + `legacyData.legacyNoLines`.
- `finalizedAt` = plaatsingsdatum bij betaalde orders of als `is_order_placed_event_fired` (voorraad was al
  afgeboekt) — voorkomt dubbele voorraad-/factuurverwerking. `fulfillmentStatus` volgens
  `invoices-and-fulfillment.md` (betaald en gearchiveerd/> 14 dagen → DELIVERED).
- **Payment:** Mollie `tr_…` → MOLLIE; betaalde overschrijving/contant → MANUAL PAID; onbetaald zonder id → geen rij.
- Ongeldige/lege `uuid` → nieuwe UUID (oude waarde in `legacyData.legacyUuid`). Onbekend land → `ZZ` (gemeld).

### Redirects
`fromPath` via `normalizeRedirectPath` (gedeeld met de runtime), `toPath` altijd relatief. Geen rijen voor wat de
runtime zelf doet: `/shop.php?code=N`, `/basket`, `/profile*`, `/checkout/guest`, `/shop/tag/{naam}`,
`/product/{id}[/{slug}]`. Wel: `/home`, `/pages/home`, `/shop.php` → `/shop`, gewijzigde categorieslugs,
`/pages/{url}` → `/{slug}`, en `/terms`, `/news`, … als de nieuwe slug afwijkt. Handmatige redirects worden nooit
overschreven; verouderde LEGACY-rijen worden verwijderd.

## Rapport
Markdown met per entiteit legacy / nieuw / bijgewerkt / ongewijzigd / overgeslagen (met reden), omzet legacy vs
nieuw (betaalde orders, excl. refunds), orders met gereconstrueerde prijzen, producten zonder foto's, niet-gemapte
settings en verzendregio's, slug-botsingen, gegenereerde redirects, sequences en waarschuwingen. **Alleen
aantallen en id's** — geen namen, e-mailadressen of adressen. Na een echte run staat er een `AuditLog`-rij
`etl.import` met de aantallen.

## Bekende data-issues (testdump, 07-10-2026)
- 49 van 86 orders hebben geen regels (doc 04 noemde 44) → gearchiveerd.
- Alle 37 orders met regels zijn exact via productprijzen te reconstrueren (afrondingsverschillen −38…+20 ct).
- 2 `manual`-orders hebben `order_paid_on` → als PAID geïmporteerd: betaalde omzet nieuw = legacy + € 235,61.
- 964 van 970 producten zonder foto's (testrommel, vrijwel allemaal INACTIVE → DRAFT); 6 producten met samen 73
  foto's (placeholders, nog te downloaden). Slug-botsingen: `dhdhdh` ×3, `test` ×3.
- Regio "Freeyo" heeft geen landen → afgeleid NL, BE uit orders (controleren). "Pickup in store" → afhaalzone.
- Beide legacy-staffaccounts hebben rol `admin` (Concept-leverancier) → OWNER; beoordelen of dat gewenst is.
- 4 van 5 nieuwsbriefabonnees zijn oude `pending` → niet gemigreerd (geen toestemming).
- Content bevat één Cloudflare-afbeeldings-URL in tekst; settings logo/banner/cta zijn leeg in de dump.

## Tests
- Unit: `tests/etl/transforms.test.ts` (foto-JSON, prijsreconstructie, status, slugs, settings-mapping,
  redirect-normalisatie, URL-mapping, adressen, CLI-args, facet-CSV).
- Integratie: `tests/etl/etl.int.test.ts` draait de hele ETL op een kleine fixture (`tests/etl/fixture.ts`) via
  `MemoryLegacyReader` en een nep-downloader — geen MariaDB nodig in CI. Controleert dry-run (niets geschreven),
  een volledige import, idempotentie van een tweede run, het niet-overschrijven van herhashte wachtwoorden en de
  weigering van een tenant met niet-ETL-data.
