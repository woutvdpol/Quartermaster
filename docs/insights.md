# Inzicht in de voorraad ("Insights")

Admin-pagina `/admin/insights` (menu: Overview › Insights). Besluit: `docs/02-besluiten.md` › Innovatieronde 3.
Ontwerp: `docs/design/insights-duplicates-i18n/Main.dc.html`.

Code: `src/server/insights/` (`pure.ts` rekenwerk, `queries.ts` SQL, `search-stats.ts` zoekstatistiek,
`index.ts` service) en `src/app/admin/(app)/insights/`.

## Periode
`?period=90d | 12m | ytd` (standaard 12 maanden), in de tijdzone van de shop. De vergelijking is met de
periode ervoor: de 90 dagen ervoor, het jaar ervoor, of dezelfde periode vorig jaar (dit jaar).

## Kerncijfers
- **Voorraad tegen inkoop**: Σ inkoopprijs × aantal van ACTIVE + RESERVED. Ook tegen verkoopprijs.
  Artikelen zonder inkoopprijs tellen als 0 en worden apart gemeld.
- **Mediaan dagen tot verkoop**: verkoopmoment (betaalde order, `COALESCE(paidAt, placedAt)`) min
  `publishedAt`. Orderregels zonder publicatiedatum tellen niet mee.
- **Sell-through**: deel van de artikelen die in de periode online kwamen (`publishedAt`) en inmiddels
  verkocht zijn (`soldAt`).
- **Vast geld > N dagen**: voorraad tegen inkoop die langer dan N dagen online staat
  (`COALESCE(publishedAt, createdAt)`). N = `?stale=90 | 180 | 365` (standaard 180).

Een verkoop is een orderregel van een betaalde order (zoals dashboard en margerapport). Omzet is na
couponkorting (pro rata over de regels); marge = (omzet − inkoop) / omzet over regels met inkoopprijs.

## Per categorie
Per hoofdcategorie inclusief subcategorieën: op voorraad, verkocht, mediaan dagen, marge en sell-through.
Daaronder één zin als de snelste categorie minstens 1,5× zo snel verkoopt als de traagste.

## "Buy more of these"
Groepen = hoofdcategorie × facetwaarde van het soort COUNTRY of PERIOD (plus de hele categorie).
Een groep komt erin als: ≥ 3 verkocht, mediaan dagen ≤ die van de shop, marge ≥ die van de shop (als er
inkoopprijzen zijn) en weinig voorraad (≤ max(2, verkocht/3)). Volgorde: verkocht / mediaan dagen,
gewogen met marge, gedeeld door voorraad + 1.

Daarnaast de zoekopdrachten zonder resultaat uit `SearchQueryStat`.

## Zoekstatistiek (`SearchQueryStat`)
Per shop, lokale dag en genormaliseerde zoekterm (NFC, kleine letters, spaties samengevoegd, max. 120
tekens): aantal zoekopdrachten en aantal zonder resultaat. Geen bezoekersgegevens.
Geteld in `CatalogView` alleen bij een volledige zoekopdracht in de shop: eerste pagina, geen "load more",
geen "letterlijk zoeken", niet binnen een categorie of facet-landingspagina. Suggesties tijdens het typen
tellen niet. Niet geteld: bots (`isBot`), termen korter dan 2 tekens en voorraadnummers ("50160",
"No. 50160"). Het schrijven gebeurt na het antwoord (`after()`), dus het zoeken wordt er niet trager van.

## "Sitting too long"
ACTIVE-artikelen die langer dan N dagen online staan (oudste eerst, max. 30 getoond) met:
- **views**: paginaweergaven van `/product/{nummer}/…` (ook met `/nl`, `/de` ervoor) uit de eigen
  statistiek (max. 400 dagen bewaard). "—" als de shop geen eigen statistiek heeft (bijv. Matomo);
- **alerts**: verlanglijstjes + verstuurde zoekalerts voor het artikel;
- **waarom** (in deze volgorde): vergelijkbare stukken verkochten duidelijk goedkoper → prijs (met de
  prijsrange); ≥ 40 views of iemand volgt het → "price?"; < 3 views per 30 dagen → slecht vindbaar;
  categorie verkoopt ≥ 1,5× trager dan de shop → trage categorie; anders "lang online".
- **voorstel**:
  - *Reprice to €X*: mediaan verkoopprijs van ≥ 3 vergelijkbare VERKOCHTE stukken (zelfde categorie,
    minstens 2 gedeelde facetwaarden of de ene die het artikel heeft), afgerond zoals de beursvloer
    (hele €, €5, €10, €50). Alleen als dat ≥ 5% lager is en niet onder de inkoopprijs.
    Eén klik + bevestiging; de prijs gaat via `updateProduct` (audit, shop-cache, prijsdaling-alerts
    voor verlanglijstjes). Geweigerd als de prijs intussen veranderd is.
  - *Feature on homepage* (link naar de homepage-editor), *Take to next fair* (link naar de eerstvolgende
    beurs in voorbereiding), *Bundle offer with …* (hint): alleen links/tekst, er verandert niets vanzelf.

## Snelheid
Per sectie één of twee aggregatie-queries (`$queryRaw`, altijd met `tenantId`), 120 s gecachet per shop
(`unstable_cache`, tags `tenant:{id}`, `tenant:{id}:catalog`, `tenant:{id}:insights`): elke product- of
orderwijziging die de shop ververst, ververst ook deze cijfers.

## Bekende beperkingen
- "Bump to top" zet `publishedAt` op nu: zo'n artikel lijkt daarna korter online (dagen tot verkoop,
  sell-through en "sitting too long" rekenen vanaf de bump).
- De views-query leest alle productweergaven van de shop uit de bewaartermijn; bij heel veel verkeer
  is een dagaggregaat per product sneller.
