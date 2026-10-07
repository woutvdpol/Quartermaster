# ETL — Compliance per land (Concept500 → Quartermaster)

**Bron:** Concept500 kent alleen de vlag `products.blur` (gevoelig item: wazige foto's + inloggen
voor gasten) en `age_restricted`. Er zijn **geen** landregels in de legacy-data.

## Mapping

| Concept500 | Quartermaster | Opmerking |
| --- | --- | --- |
| `products.blur` | `Product.blurred` | ongewijzigd gedrag ("zoals nu", besluit 19) |
| `products.age_restricted` | `Product.ageRestricted` | |
| — | `Product.restrictedSymbols` | default `false`; eventueel afleiden uit categorie/tags (handmatig) |
| — | `Product.requiresDeactivationCert` | default `false` (nieuw; gedeactiveerde wapens) |
| — | `ComplianceRule` | geen legacy-regels → **leeg** na migratie |

## Na de migratie (handmatig door de eigenaar, in Admin → Compliance)

- Voorbeeldregel: "Items met verboden symbolen" × DE+AT (preset "§86a") × *Hide from the shop*.
- Regels werken op het land van de bezoeker (edge-header `cf-ipcountry` / `x-vercel-ip-country` /
  `x-country`, door de proxy gezet). Onbekend land → geen landregels; de bestaande blur-voor-gasten
  blijft altijd gelden. Checkout controleert `NO_SHIPPING`/`HIDE_PRODUCT` op het verzendland.
- Producten met `requiresDeactivationCert` kunnen pas ACTIVE als er een `ProductDocument` van soort
  `DEACTIVATION_CERT` is (geen legacy-documenten → de ETL moet zulke producten niet ACTIVE zetten
  zonder certificaat, of de vlag leeg laten).
