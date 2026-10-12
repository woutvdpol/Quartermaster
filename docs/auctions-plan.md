# Veilingen — plan

Status: **ontwerp, nog niet gebouwd** (12-10-2026). Ontwerp: `docs/design/auctions/` (artifact "Auctions").

## Besluiten eigenaar (12-10-2026)
- **Vorm:** veilingdagen met catalogus (kavels sluiten één voor één) **én** doorlopende losse kavels. Een losse kavel is technisch een veiling met één kavel.
- **Opgeld:** geen; de hamerprijs is de prijs (plus verzending).
- **Bieders:** iedereen met een geverifieerd account, **zonder limieten**. Vangnet: bieders blokkeren en signalen van verdacht biedgedrag.
- **Onverkochte kavels:** gaan automatisch terug naar de webshop.

## Spelregels
- **Automatisch bieden (maximumbod):** het systeem biedt namens de bieder in stappen tot zijn maximum. Bij een gelijk maximum wint wie het eerst bood.
- **Biedstappen:**

  | Bod tot | Stap |
  |---|---|
  | €100 | €5 |
  | €500 | €10 |
  | €1.000 | €25 |
  | daarboven | €50 |

  De staffel is per shop instelbaar.
- **Startprijs en minimumprijs:**
  - Startprijs: standaard 60% van de lijstprijs.
  - Minimumprijs: standaard inkoopprijs + 10%, verborgen. Bezoekers zien alleen "Reserve met" of "Reserve not met".
- **Verlenging bij laat bieden:** een bod in de laatste 2 minuten verlengt alleen die kavel met 2 minuten. Bij veilingdagen sluiten de kavels standaard met 1 minuut ertussen.
- **Bod intrekken:** niet mogelijk voor de bieder. Medewerkers kunnen een bod schrappen; dat wordt gelogd en de positie wordt opnieuw berekend.
- **Wie niet mag bieden:** medewerkers en de eigenaar. Leeftijdsgrens en compliance per land gelden ook voor bieden.
- **Openbaarheid:** de biedgeschiedenis staat openbaar, met schuilnamen ("Bieder 7"; per veiling een vast nummer per bieder).

## Na de sluiting
- **Bericht aan de winnaar:** direct een e-mail en pushmelding met een persoonlijke betaallink (hetzelfde patroon als de betaallink bij biedingen: token-hash + vervaldatum). Betalen via Mollie binnen 5 dagen (instelbaar), met een herinnering na 3 dagen.
- **Niet betaald:** de medewerker annuleert en kan de bieder blokkeren. Het aanbod aan de tweede-hoogste bieder komt in fase 2.
- **Niet verkocht:** het product gaat terug naar ACTIVE in de webshop. Is de minimumprijs gehaald en betaald, dan wordt het een gewone order met factuur.

## Juridisch — eerst laten checken
- **Herroepingsrecht:** een online veiling is verkoop op afstand (EU-richtlijn 2011/83/EU). Kopers houden **14 dagen herroepingsrecht**. De uitzondering voor "openbare veilingen" geldt alleen als consumenten fysiek aanwezig kunnen zijn.
- **Veilingvoorwaarden:** een aparte pagina die bieders accepteren voor hun eerste bod (de acceptatie wordt opgeslagen).
- **Opgeld:** niet van toepassing (geen opgeld). Gaat het later wel aan, dan eerst de btw en margeregeling met de boekhouder afstemmen.

## Technisch ontwerp (fase 1)
- **Datamodel:**

  | Model | Velden |
  |---|---|
  | `Auction` | type `DAY` of `SINGLE`, status `DRAFT`, `PUBLISHED`, `LIVE`, `CLOSED`; `opensAt`, `firstCloseAt`, `gapSeconds`, `extendSeconds`, `payDays`, `incrementTable` |
  | `AuctionLot` | auction, product, `lotNumber`, `startPrice`, `reservePrice`, `closesAt` (verschuift bij verlenging), `currentBid`, `leadingBidderId`, `bidCount`, status `OPEN`, `SOLD`, `UNSOLD`, `CANCELLED`, `orderId` |
  | `Bid` | lot, bidder (Customer), `amount`, `maxAmount`, `isAuto`, `createdAt`, `voidedAt`, `voidedBy`, IP- en device-hash voor de signalen |
  | `AuctionBidder` | auction, customer, schuilnummer, `termsAcceptedAt` |
  | `BlockedBidder` | tenant, customer, reden |

  Daarnaast `Product.auctionHoldId`, zoals de beursmodus `fairHoldId` gebruikt: zo verdwijnt het stuk uit de shop zodra de veiling is gepubliceerd.
- **Bieden:**
  - Bieden is één databasetransactie: `SELECT … FOR UPDATE` op de kavelrij, daarna de maximumbod-berekening en de verlenging, met idempotentie per client-request-id.
  - Na de transactie volgen `NOTIFY auction_lot_<id>`, een pushmelding of e-mail aan wie overboden is, en een audit-regel.
- **Live verversen:** een SSE-endpoint per veiling (`/api/auctions/<id>/stream`) luistert via Postgres `LISTEN` en stuurt kavelupdates naar de browser.
  - De client synchroniseert zijn klok met de server (servertijd in elk bericht).
  - Is SSE er niet, dan valt de client terug op polling elke 5 s.
  - Een SSE-verbinding loopt via de proxy (ingress: `proxy-buffering off`, lange timeout).
- **Sluiten:**
  - Een pg-boss cron elke 10 s sluit kavels waarvan `closesAt` voorbij is.
  - Een kavel die bij het lezen al voorbij `closesAt` is, wordt ook als gesloten getoond.
  - Sluiten is idempotent: dezelfde lock als bij bieden, daarna order of betaallink, of terug naar de shop.
- **Koppelingen met bestaande onderdelen:**
  - **Push:** nieuwe soorten meldingen: `AUCTION_OUTBID`, `AUCTION_ENDING` (5 min, voor kavels die je volgt of waarop je biedt) en `AUCTION_WON`.
  - **Alerts:** een opgeslagen zoekopdracht matcht ook nieuwe kavels.
  - **Archief:** de hamerprijs komt in het verkocht-archief (per stuk aan te zetten).
  - **Insights:** veilingresultaten.
  - **Meertaligheid:** vaste teksten in NL en DE.
- **Tests:**
  - de maximumbod-berekening en de staffel (puur);
  - gelijktijdige biedingen: N parallelle biedingen, precies één winnaar en een consistente stand;
  - verlenging en sluiten, en terug naar de shop;
  - e2e: bieden, overboden worden en winnen.

## Fasering
| Fase | Inhoud |
|---|---|
| 1 | Veilingdag + losse kavels, maximumbod, staffel, minimumprijs, verlenging, live (SSE), overboden-melding, winnaar-betaallink, admin (opzetten, live volgen, resultaten), blokkeren en signalen, veilingvoorwaarden |
| 2 | Aanbod aan de tweede bieder, vooraf bieden voordat de veiling opent, catalogus als PDF, hamerprijzen in het archief, opgeld (optioneel, na advies van de boekhouder) |
| 3 | Veilingkalender over het netwerk; eventueel live veilen met afslager |
