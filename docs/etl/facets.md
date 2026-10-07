# ETL — Facetten (Concept500 → Quartermaster)

**Bron:** Concept500 heeft geen taxonomie: alleen platte `tags` (+ `product_tag`) en een categorieboom van
2 niveaus (`categories`). Facetten (`Facet`, `FacetValue`, `ProductFacetValue`) zijn nieuw.

## Aanpak

1. **Tags en categorieën eerst 1-op-1** migreren zoals gepland (`Tag.legacyId = tags.id`,
   `ProductTag`, `Category.legacyId`). Daarmee blijft niets verloren.
2. **Standaardfacetten** per tenant aanmaken: `seedDefaultFacets(tenantId)` (src/server/facets) —
   Period, Country, Branch, Unit, Type, Maker + startwaarden (WW1, WW2, …; Germany, …; Army › Heer, …).
3. **Mappingbestand** (CSV, per tenant, met de hand/eenmalig opgesteld door de eigenaar):

   ```csv
   legacy_tag_id,facet_kind,value_name,parent
   12,PERIOD,WW2,
   31,COUNTRY,Germany,
   44,BRANCH,Heer,Army
   45,BRANCH,KNIL,Army
   70,UNIT,Infanterie-Regiment 9,Heer
   ```

   - `facet_kind`: `PERIOD|COUNTRY|BRANCH|UNIT|TYPE|MAKER|CUSTOM` → de facet van die soort (bij CUSTOM:
     extra kolom-loze conventie `CUSTOM:<facetnaam>` mag, facet wordt dan aangemaakt).
   - `value_name`: bestaande waarde (hoofdletterongevoelig op naam binnen de facet) wordt hergebruikt,
     anders aangemaakt. `parent` (optioneel) = naam van de ouderwaarde in dezelfde facet (wordt
     aangemaakt als die ontbreekt). Meerdere tags mogen naar dezelfde waarde (synoniemen: "WO2", "WWII").
   - Tags die **niet** in het bestand staan blijven gewone tags (shop toont ze onder "Tags").
4. **Toepassen** (idempotent, per regel): waarde bepalen/aanmaken, `FacetValue.legacyTagId` = 
   `legacy_tag_id` zetten als die nog leeg is, en alle producten van die tag koppelen
   (`INSERT … ON CONFLICT DO NOTHING` in `product_facet_values`). Dit is precies
   `convertTagsToFacet(ctx, tagIds, facetId, { parentId, deleteTags })` — de ETL mag die service per
   groep (facet + parent) aanroepen met de gemigreerde `Tag.id`'s.
5. **Tags verwijderen** na conversie (`deleteTags: true`) is aanbevolen: de shop stuurt oude links
   `/shop?tag=<slug>` met een 308 door naar `/shop?f=<facet>.<waarde>` zolang de waarde-slug gelijk is
   aan de oude tag-slug (dat is zo bij conversie: de slug wordt van de tag overgenomen).
   Blijven de tags bestaan, dan verbergt de shop tags waarvan `legacyId` aan een `FacetValue.legacyTagId`
   gekoppeld is (geen dubbele filters).
6. **Type uit categorieën (optioneel):** per hoofdcategorie een Type-waarde en alle producten van die
   subboom koppelen (zie `scripts/seed-facets-demo.ts`). Categorieën zelf blijven bestaan (navigatie).

## Defaults die de ETL moet zetten

- `Facet.isFilterable = true` (Maker eventueel `false` als er nog weinig data is), `sortOrder` volgens
  de standaardvolgorde.
- `FacetValue.slug` uniek per facet (service doet dit), `legacyTagId` = Concept500 `tags.id`.
- `ProductFacetValue.tenantId` = tenant van het product.

## URL-vorm in de shop

`/shop?f=<facetSlug>.<valueSlug>` (herhaalbaar; OF binnen een facet, EN tussen facetten; een waarde
omvat haar subwaarden). Ook `f=<facetValueId>` wordt geaccepteerd (saved searches) en doorgestuurd naar
de leesbare vorm. Landingspagina per waarde: `/shop/facet/<facetSlug>/<valueSlug>`.
