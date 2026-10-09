# Quartermaster-netwerk

Eén openbare zoekpagina over de voorraad van alle handelaren die meedoen (besluit "Innovatieronde 2",
`docs/02-besluiten.md`). De koper zoekt op het netwerk en rekent af in de **eigen shop van de handelaar**:
elk resultaat linkt naar `https://<primair domein van de shop>/product/<voorraadnummer>/<slug>`.
Het verdienmodel komt later; er staat bewust geen voorwaarden-tekst op de pagina.

## Waar

- Zonder `NETWORK_HOST`: `PLATFORM_HOST/network` (zoeken) en `PLATFORM_HOST/network/dealers` (handelaren).
- Met `NETWORK_HOST` (bijv. `network.example`): die host serveert het netwerk op `/` en `/dealers`
  (de proxy herschrijft `/x` naar `/network/x`); `PLATFORM_HOST/network/…` stuurt met een 308 door.
  De domeinnaam is nog niet gekozen; DNS + certificaat zijn nodig voordat je hem zet.
- Shop-hosts en onbekende hosts geven 404 op `/network`. De pagina's zijn openbaar en alleen-lezen.
- Code: `src/lib/network.ts` (routing, links), `src/server/network/` (deelname, zoeken, beheer),
  `src/app/(shop)/network/` (pagina's), `src/app/api/network/image` (zoeken op foto).

## Meedoen (opt-in per handelaar)

- Eigenaar: Instellingen → General → kaart "Quartermaster network", schakelaar
  "Show my stock in the Quartermaster network". Zet `Tenant.networkOptIn` / `networkJoinedAt`,
  wordt gelogd (`tenant.network_joined` / `tenant.network_left`) en is direct zichtbaar (cache-tag `network`).
- Zichtbaar alleen als de shop ACTIVE is, live is (setup-wizard afgerond of een shop van vóór de wizard)
  en een primair domein heeft. De kaart zegt het als iets daarvan ontbreekt.
- Superadmin (Platform → shop): status in de lijst (kolom "Network") en op de shoppagina
  "Remove from network". Dat zet ook platforminstelling `networkBlocked`, zodat de eigenaar niet zelf
  opnieuw kan aanmelden; "Allow again" heft dat op (`tenant.network_removed` / `tenant.network_allowed`).

## Wat er niet in komt, en waarom

- Alleen `ACTIVE` met voorraad. Niet: gereserveerd, verkocht, concept, gearchiveerd.
- Niet op een beurs (`fairHoldId` gezet): de beursmodus haalt die stukken ook uit de webshop.
- Niet `blurred` (gevoelig voor gasten), niet `ageRestricted`.
- **Nooit `restrictedSymbols`**, ongeacht de landregels van de handelaar. Het netwerk is één
  grensoverschrijdende etalage; we vertrouwen er niet op dat elke handelaar voor elk land regels heeft (§86a StGB).
- Landregels van de handelaar voor het land van de bezoeker (`visitorCountry`, compliance): **elke** regel
  die op het land en product past sluit uit, ook "afbeelding vervagen" en "niet verzenden" — een netwerkkaart
  kan niet vervagen of uitleggen dat het stuk niet naar je toe kan. Onbekend land = geen landregels (zoals in de shop).

## Zoeken

- Dezelfde motor als de shop (`src/server/search`): full-text + trigram, e5-tekstvectoren en SigLIP
  (tekst → foto), samengevoegd met RRF (`searchAcrossTenants`, `vectorSearch` met meerdere tenants).
  Facetten, synoniemen en prijszinnen zijn per shop en worden in het netwerk niet geïnterpreteerd:
  alleen vrije tekst en voorraadnummers.
- Filters: handelaar, "verzendt naar <land van bezoeker>" (actieve, niet-afhaal verzendzones met het land of `*`),
  periode en land van herkomst. Die laatste twee koppelen facetwaarden van het soort PERIOD/COUNTRY over shops
  heen op **naam** (hoofdletter- en accentongevoelig, alleen bovenste niveau; onderliggende waarden tellen mee).
- Zoeken op foto: cameraknop in het zoekveld → `POST /api/network/image` (zelfde limieten als in de shop,
  foto alleen in het geheugen).
- Sortering: beste match of nieuwste. Geen prijssortering: prijzen staan in de valuta van de handelaar.

## Afbeeldingen

Productfoto's staan als `/uploads/<tenant>/…` en de uploads-route is niet host-gebonden: het platform (en
`NETWORK_HOST`) serveert ze zelf, met de bestaande AVIF/WebP-varianten (`<picture>`). Geen CSP-wijziging nodig;
gevoelige (blurred) stukken komen niet in het netwerk en de route blijft ze voor gasten weigeren.

## Prestaties en cache

- Handelaarsoverzicht (handelaren, verzendzones, periode/land-waarden, aantallen) en elke zoekpagina staan
  60 s in de data-cache. Zoekresultaten dragen ook de catalogus-tag van elke handelaar, dus een productwijziging
  in een shop maakt ze direct ongeldig (boven 120 handelaren alleen de korte levensduur).
- De zoekvragen gebruiken dezelfde indexen als de shop (GIN op `searchVector`/titel-trigram, HNSW op de vectoren
  met `tenantId = ANY(…)`).

## SEO

- `/network` en `/network/dealers` zijn indexeerbaar (canonical, JSON-LD `Organization` + `ItemList`);
  zoek-/filtervarianten krijgen `noindex, follow`.
- Sitemap van het platform bevat beide pagina's (zonder `NETWORK_HOST`); met `NETWORK_HOST` heeft die host
  een eigen `robots.txt` en `sitemap.xml`.
