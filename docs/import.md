# Productimport (WooCommerce / Shopify CSV)

Admin: **Voorraad → Import** (`/admin/inventory/import`). Herbruikbaar component `ProductImport`
(`src/components/admin/import/ProductImport.tsx`) voor de startwizard. Code: `src/server/import/`.

## Stroom

1. **Upload** (route `POST /admin/inventory/import/upload`, max 20 MB, staff + same-origin). Het bestand
   wordt privé opgeslagen als `{tenantId}/imports/{jobId}.csv` (`.csv` wordt nooit door `/uploads` geserveerd),
   geparsed, en de preview komt in `ImportJob.summary.preview` (status `UPLOADED`).
2. **Preview**: aantallen (producten, artikelen bij splitsen/niet splitsen, foto's, categorieën bestaand/nieuw,
   regels die aandacht vragen), kolom-mappingtabel met voorbeeld, waarschuwingen en overgeslagen regels met
   regelnummer (spreadsheet-nummering: kopregel = 1). Opties: publiceren, tags → facetten of tags,
   voorraad > 1 splitsen of 1 houden, foto's downloaden.
3. **Start** → `RUNNING`, job `import.run`: per bronproduct één transactie. Daarna `IMAGES` + job
   `import.images` (foto's), dan `DONE`. **Annuleren** kan altijd; wat al gemaakt is blijft staan.
4. **Resultaat**: aangemaakt / gepubliceerd / concepten / mislukt (met reden), foto's gelukt/mislukt, link naar
   de voorraadlijst gefilterd op deze import (`?view=all&import={jobId}`), en "Concepten van deze import
   verwijderen" (alleen DRAFT zonder historie; gepubliceerde/verkochte artikelen blijven).

## Besluiten

- **Elk artikel is uniek.** Voorraad > 1: "splitsen" = N losse artikelen (max 50; SKU `X`, `X-2`, `X-3`…) of
  "1 houden" (waarschuwing). Voorraad 0 / niet op voorraad → concept zonder voorraad. Niet bijgehouden → 1.
- **Varianten** (Woo `variable` + `variation`, Shopify meerdere variant-rijen per Handle): het product wordt
  **één concept-artikel** (prijs van het hoofdproduct of de eerste variant), nooit gesplitst, nooit
  automatisch gepubliceerd. Variaties worden niet als losse artikelen geïmporteerd (waarschuwing).
- **Overgeslagen**: Woo `grouped` en `external`, Shopify gift cards, regels zonder naam, dubbele ID's.
- **Prijs** = wat de klant betaalt: actieprijs als die lager is (dan `onSale = true`), anders de reguliere prijs.
  Shopify: `Variant Price` is de prijs, `Compare At Price` (hoger) → `onSale`. Reguliere prijs staat in
  `legacyData.regularPrice`. Inkoopprijs: Shopify `Cost per item`, Woo `Meta: _wc_cog_cost` (e.a.).
- **Publiceren** (optie): alleen artikelen die in de bronwinkel gepubliceerd waren (Woo `Published = 1`,
  Shopify `Status = active`) én prijs > 0, voorraad > 0 en geen varianten. Al het andere wordt concept.
- **Categorie**: Woo — de **eerste** categorie (`A > B` wordt een boom; ontbrekende categorieën worden
  aangemaakt, bestaande gematcht op pad, hoofdletterongevoelig). Shopify — `Type` (één niveau), anders het
  laatste deel van `Product Category` (de Shopify-taxonomie is te generiek).
- **Tags**: "facetten" = tags die (hoofdletterongevoelig) overeenkomen met een bestaande facetwaarde worden
  daaraan gekoppeld (eerste facet op volgorde wint); de rest wordt een gewone tag. "Tags" = alles gewone tags.
  Er worden geen nieuwe facetwaarden aangemaakt.
- **Omschrijving**: HTML → onze Markdown-subset (`src/server/content/html-markdown.ts`, gedeeld met de ETL);
  korte omschrijving eerst. Nooit ruwe HTML; afbeeldingen in de tekst vallen weg. Woo-escapes (`\,` in
  lijsten, `'` voor formules, letterlijke `\n`) worden ongedaan gemaakt. SEO: Yoast/Rank Math-meta, Shopify
  `SEO Title/Description`.
- **Gewicht** → grammen (Woo-eenheid uit de kop `Weight (kg|g|lbs|oz)`, Shopify `Variant Grams`).
- **CSV**: eigen RFC 4180-parser (`csv.ts`, geen dependency): quotes, regeleinden in velden, BOM, `,`/`;`/tab-
  detectie, UTF-8 met terugval op Windows-1252, limieten op rijen/kolommen/veldlengte. Woo-koppen ook in
  (best-effort) NL/DE.
- **Idempotent**: elk artikel krijgt `Product.legacyData { importJobId, source, sourceId, sourceKey, unit, row,
  originalSku, regularPrice, images, imagesDone, imagesState }`. Een (her)run slaat bestaande `sourceKey`s
  over; fotovoortgang per artikel staat in `imagesDone`. Een mislukte import kan opnieuw gestart worden.
- **SKU al in gebruik** bij een ander product → artikel zonder SKU (melding in de preview).

## Beveiliging

- Upload: staff-sessie + tenant (`requireStaffContext`), same-origin-check, 20 MB, binaire bestanden
  geweigerd, privé opslag; alles tenant-gescoped (ook de jobs: verkeerde tenant in de payload doet niets).
- Foto's via `src/server/security/safe-fetch.ts`: alleen http/https, geen credentials in de URL, alleen
  poort 80/443, DNS vooraf opgelost en **alle** adressen moeten publiek zijn (`ip-ranges.ts`: loopback,
  RFC 1918, link-local/metadata 169.254.169.254 en fd00:ec2::254, CGNAT, multicast, gereserveerd, IPv4-in-IPv6
  incl. NAT64/6to4/Teredo), socket vastgepind op het gecontroleerde adres (geen DNS-rebinding), redirects
  handmatig (max 3, elke hop opnieuw gecontroleerd), timeout 20 s, max 15 MB, `Content-Type: image/*` (geen
  SVG), daarna valideert sharp (`processImage`). Opslagquotum van de tenant geldt (`addProductImages`); bij
  overschrijding stoppen de downloads met een melding.
- Audit: `import.upload|start|retry|cancel|discard|published|products_done|done|failed|undo`, plus
  `category.create` / `tag.create` (met `via: "import"`) en de gewone `product.images.added`.

## Worker (lokaal)

Jobs draaien in de pg-boss-worker, niet in Next.js. Lokaal: `npx tsx scripts/worker.ts` (of
`docker compose --profile app up -d worker`). Zonder worker blijft een import op "Waiting for the background
worker…" staan. Queues `import.run` / `import.images`: policy `singleton` met `singletonKey = jobId` (één
handler per import tegelijk), tijdsbudget 4 min per slice met vervolgjob, 2 retries; na de laatste poging →
`FAILED`.

## Open punten

- Geüploade CSV's blijven bewaard (geschiedenis/herstart); opruimen na X dagen kan als cron-taak.
- Facetwaarden worden alleen gematcht, niet aangemaakt; een "maak ontbrekende facetwaarden"-optie kan later.
- Bij "concepten verwijderen" blijven door de import aangemaakte (lege) categorieën en tags bestaan.
- Shop-cache: invalidatie vanuit de worker heeft geen request-scope (zoals bij andere jobs).
