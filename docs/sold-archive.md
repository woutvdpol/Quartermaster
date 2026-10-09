# Verkocht-archief

Verkochte stukken blijven in de shop zichtbaar als naslag: met foto's, kenmerken en staat, maar zonder koopknop. Besluit: docs/02-besluiten.md, "Innovatieronde 2". Ontwerp: docs/design/fair-archive-push-network/SoldArchive.dc.html en SoldProduct.dc.html.

## Instellingen

- **Shop:** `catalog.publicArchive` ("Sold archive enabled" in Settings › Catalog), standaard **aan**. Uit: geen `/archive`, geen archieflink, verkochte pagina's `noindex` en niet in de sitemap.
- **Per item** (productpagina in de admin, kaart "Sold archive"; ook als bulkactie in de voorraadlijst):
  - "Show in sold archive" = `!Product.archiveHidden` (standaard aan).
  - "Show sold price in archive" = `Product.showSoldPrice` (standaard uit).
- De oude shopbrede instelling `catalog.showPriceWhenSold` wordt niet meer gelezen. De ETL zet hem om naar `showSoldPrice` op de verkochte items.

## Storefront

- **`/archive`** en **`/archive/category/{slug}`**: dezelfde catalogusweergave als de shop (`CatalogView` met `mode="archive"`): zoeken, categorieën, facetten, sorteren (standaard "recent verkocht", `soldAt` desc), paginering. Filter: `status = SOLD` en niet `archiveHidden`. Index: `products(tenantId, soldAt)`.
- Compliance (per land verbergen of blurren), gevoelige items (blur voor gasten) en leeftijdsgrenzen werken precies als in de live catalogus.
- Kaarten tonen "Sold", "Sold Oct 2026" en alleen een prijs bij `showSoldPrice`. Een verborgen prijs verlaat de server niet (DTO-prijs 0). Prijsfilter, prijssortering en prijsgrenzen kijken alleen naar getoonde prijzen.
- Onderaan het archief: "Looking for one of these?" → opgeslagen zoekopdracht met de huidige filters.
- Zoeken op "verkocht"/"sold" springt alleen naar het archief als het archief aan staat.
- Footer: standaardlink "Sold archive", tenzij het footermenu al naar `/archive` linkt.

## Verkochte productpagina

- Galerij, kenmerken en staat; badge "Sold · Oct 2026"; prijs ("Sold for …") alleen bij `showSoldPrice`.
- Geen koopknop. In plaats daarvan "Want one like this?": een alert, vooraf gevuld met de categorie en facetwaarden van het item (`suggestedQueryForProduct`), plus "N similar pieces for sale now" uit "Looks like this" (smart search, `getSimilarProducts`). De rail verschijnt op een verkochte pagina vanaf één stuk.
- Breadcrumbs: Sold archive › categorie › item (als het item in het archief staat).
- SEO: de pagina blijft bereikbaar en canonical. Indexeerbaar alleen als het item in het archief staat (archief aan, niet verborgen, niet gevoelig). JSON-LD: `Product` zonder `Offer`, of met prijs een `Offer` met `availability: https://schema.org/SoldOut` (zonder verzending/retour).
- Markdown-alternatief (`/product/{No}.md`): "Availability: Sold (Oct 2026); no longer for sale…", geen prijsregel, behalve "Sold for" bij `showSoldPrice`. `llms.txt` noemt het archief als het aan staat.

## Code

- Regels: `src/server/storefront-catalog/sold.ts` (pure; tests in `sold.test.ts`).
- Queries: `src/server/storefront-catalog/queries.ts` (`VISIBLE_ARCHIVE`, `priceSql`).
- Pagina's: `src/app/(shop)/archive/**`, `src/components/shop/catalog/product/SoldAlternatives.tsx`.
- Admin: `src/app/admin/(app)/inventory/[id]` (switches), `src/app/admin/(app)/inventory/actions.ts` (`bulkSoldArchiveAction`).
