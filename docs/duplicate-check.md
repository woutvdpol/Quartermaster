# Dubbelcheck bij het uploaden van foto's

Na het uploaden van foto's bij een product kijkt het admin of die foto's lijken op een ander product van
dezelfde shop: in voorraad, concept of verkocht (archief). Zo ziet de handelaar een stuk dat terugkomt
(teruggekocht, geretourneerd) of dat al eens is ingevoerd. Besluit: `docs/02-besluiten.md` "Innovatieronde 3",
ontwerp: `docs/design/insights-duplicates-i18n/Duplicate.dc.html`.

Code: `src/server/duplicates` (service), `src/app/admin/(app)/inventory/[id]/_ext/duplicates` (UI).

## Hoe het werkt

1. `PhotosCard` uploadt de foto's zoals altijd (route `./images`). Pas **als de uploads klaar zijn** roept hij
   de server action `checkDuplicatesAction(productId, imageIds)` aan, los van het opslaan. Het opslaan wacht
   nergens op.
2. `checkDuplicates(ctx, { productId?, imageIds | imageBuffers })` leest de eerste 4 nieuwe foto's (de
   `card`-variant, net als het indexeren), verkleint ze naar 224×224 en laat de **embedder** (SigLIP 2, dezelfde
   foto-AI als slim zoeken, `docs/search.md`) er vectoren van maken.
3. Per foto een kNN-zoekopdracht (`vectorSearch`, pgvector HNSW) tegen de foto-vectoren (`product_embeddings`,
   kind `image` = hoofdfoto per product) van **dezelfde tenant**, alle statussen, **zonder het product zelf**.
4. `selectCandidates` (puur, unit-getest): beste score per product over de foto's, minimaal "close", binnen
   0,015 van de beste, hoogstens 3.
5. Tijdslimiet 2 s voor het geheel. Is de embedder uit, koud, kapot of te traag, dan komt er **niets** terug
   (`state: unavailable/timeout`) en verschijnt er geen paneel. Uploaden wordt nooit geblokkeerd.

## Drempels (cosine, SigLIP 2)

| Band | Vanaf | Label |
|---|---|---|
| very close | 0,985 | "Very close match" |
| close | 0,97 | "Close match" |
| (niet tonen) | < 0,97 | — |

Gekalibreerd op de demo-shops (echt model, 227 foto's van 93 producten): elke foto opnieuw embedden en
vergelijken met de opgeslagen hoofdfoto-vectoren.

| Vergelijking | Min | Mediaan | ≥ 0,97 | ≥ 0,985 |
|---|---|---|---|---|
| Dezelfde foto opnieuw (hoofdfoto vs. eigen vector) | 0,988 | 0,995 | 100 % | 100 % |
| Andere foto van hetzelfde product | 0,941 | 0,977 | 78 % | 11 % |
| Beste ander product, zelfde categorie | 0,854 | 0,955 | 31 % | 7 % |

Waarom deze waarden: "very close" vangt dezelfde foto (of dezelfde opname) altijd en andere stukken zelden;
"close" vangt de meeste andere foto's van hetzelfde stuk, terwijl de meeste lijkende stukken uit dezelfde
categorie eronder blijven. Liever een gemiste melding dan een paneel bij elke upload. Let op: de demo-foto's
zijn tekeningen in één stijl, dus alles ligt dicht bij elkaar; echte foto's van verschillende stukken liggen
verder uit elkaar. **Herijken met echte foto's** zodra er een echte voorraad geïndexeerd is (zelfde methode:
foto's 2…n van een product embedden en vergelijken met de eigen hoofdfoto vs. het beste andere product).
Constanten: `src/server/duplicates/bands.ts`.

## Keuzes in het paneel

- **The same piece came back** → `Product.previousProductId` = dat product (server action, audit
  `product.lineage`, met stockCode van beide). Bij meer kandidaten kiest de handelaar welke.
- **I already listed it** → link naar dat product; de handelaar beslist zelf wat er met het huidige concept
  gebeurt (bijvoorbeeld verwijderen in de danger zone).
- **A different piece** → paneel dicht; de kandidaten worden voor dit product alleen in deze browsersessie
  onthouden (`sessionStorage`), niet op de server.

## Herkomst / lijn (alleen admin)

Bovenaan de fotokaart: "Earlier listing: No. X (sold Jul 2026)" met link, een knop
**"Copy provenance from No. X"** (alleen als dat product herkomsttekst heeft; leeg → overnemen, anders eronder
plakken; nooit automatisch) en "Remove link". Het oude product toont "Later listing: No. Y". De shop toont
niets van deze koppeling. Een koppeling naar zichzelf of een kringetje wordt geweigerd.

## Tests

- `src/server/duplicates/bands.test.ts` — banden, tenant-isolatie, zichzelf uitsluiten, concepten en verkocht
  meenemen, marge en maximum.
- `src/server/duplicates/duplicates.int.test.ts` — echte Postgres + nep-embedder (`fake-embedder.ts`,
  vector = gemiddelde kleur, zoals `npm run search -- reindex --all --fake` in CI): kandidaten, tenant-isolatie,
  embedder weg/koud/kapot/traag, koppelen + audit + herkomst kopiëren, kringetjes.

## Open punten

- Alleen de hoofdfoto van andere producten is geïndexeerd; een stuk waarvan een andere foto als hoofdfoto is
  gekozen, wordt minder goed herkend. Alle foto's indexeren kost per product meer embeddings.
- Drempels herijken op echte foto's (zie boven).
