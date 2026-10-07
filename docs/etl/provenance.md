# ETL — Herkomst, documenten en certificaten van echtheid

Fase 5-onderdelen: publieke herkomsttekst (`Product.provenance`), echtheidsgarantie
(`Product.authenticityGuaranteed`), documenten (`ProductDocument`) en certificaten van echtheid
(`Certificate`). Bronnen: `docs/analysis/02-data-model.md`, `.local/main.sql`.

## Inkoopherkomst (intern) — `product_origins` / `purchase_records`
- **Blijft intern.** Legacy `product_origins` (naam van herkomst/leverancier) → `Supplier`
  (`legacyId` = `product_origins.id`); `purchase_records` → `PurchaseRecord` (`legacyId`,
  `invoiceNumber`, `supplierId` via `product_origin_id`); `products.purchase_record_id` →
  `Product.purchaseRecordId`. Dit hoort bij de purchasing-ETL, niet hier.
- **Nooit** naar `Product.provenance` kopiëren: leveranciersnamen en inkoopfacturen zijn
  bedrijfsgevoelig (wie/waar/voor hoeveel ingekocht) en staan juist níet in de shop.

## Publieke herkomsttekst (`Product.provenance`)
**Geen legacy-data — nieuw.** De ETL zet `provenance = null`.
- Legacy `products.notes` (intern) bevat soms herkomst-hints ("uit collectie X", "gevonden in …",
  "ex Smith collection", "met originele papieren"). Die gaan 1-op-1 naar `Product.notes` (intern)
  en worden **niet** automatisch publiek gemaakt — notes bevatten ook inkoopprijzen, namen en
  adressen van verkopers. Optioneel: het ETL-log noteert producten waarvan `notes` matcht op
  `/collect|herkomst|provenance|ex |nalatenschap|estate|papieren|papers/i`, zodat de eigenaar
  die handmatig kan overnemen in het herkomstveld.
- Ook in `products.description` staat soms herkomst; dat blijft gewoon beschrijving.

## Echtheidsgarantie (`Product.authenticityGuaranteed`)
**Nieuw.** Default `false`. Geen legacy-veld (een algemene garantietekst stond hooguit in een
CMS-pagina; die blijft content).

## Documenten (`ProductDocument`)
**Geen legacy-data — nieuw.** Concept500 had alleen productfoto's (Cloudflare Images, `photos`
JSON); scans van brieven/certificaten stonden daar hooguit als gewone foto tussen. De ETL maakt
géén `ProductDocument`-rijen aan; zulke foto's blijven `ProductImage`.
Opslag bij nieuwe uploads: `{tenantId}/products/{productId}/docs/{id}.{ext}`; telt mee in het
opslagquotum.

## Certificaten (`Certificate`)
**Geen legacy-data — nieuw.** Geen rijen aanmaken. Certificaten worden vanaf livegang per item
uitgegeven (code `QM-XXXX-XXXX`, QR naar `https://<primair shopdomein>/verify/<code>`).
Let op: de QR wijst naar het **primaire** `TenantDomain` op het moment van uitgifte — zorg dat
het definitieve domein vóór de eerste uitgifte als primair staat.
