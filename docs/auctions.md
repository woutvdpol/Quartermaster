# Veilingen

Status: fase 1 (engine, sluiten, live verversen, meldingen). Plan en besluiten: `docs/auctions-plan.md`. Admin-schermen: `docs/auctions-admin.md`.

## Voor de dealer

### Een veiling opzetten
- **Veilingdag** (`DAY`): veel kavels met één catalogus. Kavel 1 sluit op het eerste sluitmoment, daarna sluit elke volgende kavel standaard 1 minuut later.
- **Losse kavel** (`SINGLE`): een veiling met precies één kavel en een eigen eindtijd.
- Bij het toevoegen van een stuk vult het systeem twee prijzen in. Beide kunt u aanpassen tot het eerste bod:
  - de **startprijs**: 60% van de lijstprijs, naar beneden afgerond;
  - de **minimumprijs**: inkoopprijs + 10%, afgerond op hele euro's. Deze prijs is verborgen; leeg betekent geen minimumprijs.
- Een stuk kan alleen een kavel worden als het `ACTIVE` is en op voorraad. Het mag niet op een beurs staan, niet in een andere veiling zitten en niet in iemands winkelwagen liggen.

### Publiceren
- Bij publiceren verdwijnen de stukken uit de webshop: uit lijsten, zoeken, sitemap, feeds en het netwerk. Niemand kan ze nog in de winkelwagen leggen.
- De productpagina blijft bereikbaar en verwijst naar de kavel.
- Op `opensAt` gaat het bieden open. Tot dat moment staat de veiling als "binnenkort" in de shop.

### Hoe bieden werkt
- **Maximumbod**: de bieder geeft zijn maximum op. Het systeem biedt namens hem steeds één stap boven de concurrent, nooit hoger dan nodig.
- **Gelijke maxima**: wie het eerst bood, wint.
- **Hoogste bieder verhoogt zijn eigen maximum**: dan verandert alleen het maximum, niet de prijs. Uitzondering: komt het nieuwe maximum boven de minimumprijs, dan springt de prijs naar de minimumprijs.
- **Minimumprijs**: reikt het maximum van de hoogste bieder tot de minimumprijs, dan springt de zichtbare prijs meteen naar de minimumprijs. Bezoekers zien alleen "Reserve met" of "Reserve not met".
- **Biedstappen** (standaard): tot €100 → €5, tot €500 → €10, tot €1.000 → €25, daarboven → €50. "Tot" is exclusief: vanaf precies €100 is de stap €10. De staffel is per veiling in te stellen.
- **Laat bieden**: een bod in de laatste 2 minuten verlengt alleen die kavel tot 2 minuten na het bod.
- **Wie mag bieden**:
  - alleen klanten met een bevestigd e-mailadres die de veilingvoorwaarden hebben geaccepteerd (daarbij krijgen ze hun vaste biedernummer);
  - geen medewerkers of de eigenaar, ook niet met een klantaccount op hetzelfde e-mailadres;
  - geen geblokkeerde bieders.
- **Compliance**: een land-regel die het stuk verbergt of verzending verbiedt, blokkeert ook bieden. Dat geldt voor het verzend- of factuurland van de klant en voor het land van de bezoeker.
- **Leeftijdsgrens**: is de leeftijdscontrole ingesteld op "bij afrekenen", dan vraagt het bod om dezelfde bevestiging.

### Na de sluiting
- **Verkocht** (er is een bod en de minimumprijs is gehaald):
  - Het systeem maakt direct een order aan (kanaal `AUCTION`, status "wacht op betaling") voor de hamerprijs, zonder opgeld.
  - De winnaar krijgt een e-mail en een pushmelding met een persoonlijke betaallink: `/auctions/pay/<token>`. Daar kiest hij verzending of afhalen en betaalt hij via Mollie. De verzendkosten worden bij de hamerprijs opgeteld.
  - Na 3 dagen zonder betaling gaat er automatisch een herinnering uit.
  - Het stuk blijft onzichtbaar in de shop tot er betaald is. Daarna wordt het `SOLD`, zoals bij elke betaalde order (met factuur).
- **Niet verkocht** (geen bod of minimumprijs niet gehaald): het stuk staat meteen weer gewoon in de webshop.
- **Niet betaald**:
  - Na de betaaltermijn (standaard 5 dagen) blijft de link werken tot u de kavel annuleert. Annuleren kan via "Annuleren (gewonnen kavel)".
  - Bij annuleren wordt de order geannuleerd, staat het stuk weer in de shop en kunt u de bieder meteen blokkeren.
  - Een order die u via het orderscherm annuleert, krijgt hetzelfde resultaat: de kavel wordt `CANCELLED` en het stuk komt terug in de shop.
- **Bod schrappen**: een medewerker kan het eigen bod van een bieder schrappen (een automatisch tegenbod kan niet). De kavel wordt daarna opnieuw berekend uit de overgebleven biedingen. Alles wordt gelogd.
- **Signalen**: de admin toont paren van verschillende klanten die hetzelfde apparaat of IP-adres gebruiken en op dezelfde kavels bieden. Een gedeeld apparaat weegt zwaarder dan een gedeeld IP-adres (gezin, kantoor, mobiel netwerk). In de database staan alleen HMAC-hashes per shop, nooit het IP-adres zelf.

### Meldingen
| Melding | Kanaal | Wanneer |
|---|---|---|
| Overboden | push (urgent) + e-mail | Iemand bood boven uw maximum. Maximaal één melding per kavel per 2 minuten, en alleen als u op dat moment nog overboden bent. |
| Sluit bijna | push | Ongeveer 5 minuten voor de sluiting, aan iedereen die op de kavel bood. Eén keer per kavel. |
| Gewonnen | push + e-mail | Direct na de sluiting, met de betaallink. Herinnering per e-mail na 3 dagen. |

- **Stille uren**:
  - "overboden" en "sluit bijna" worden in de stille uren van de klant alleen verstuurd als die in de laatste 30 minuten zelf heeft geboden; anders vervallen ze;
  - "gewonnen" wacht tot de stille uren voorbij zijn (de e-mail gaat wel direct).
- Veilingmeldingen tellen niet mee voor het daglimiet van pushmeldingen.

## Technisch

### Code
| Onderdeel | Plaats |
|---|---|
| Staffel, standaardprijzen (puur, ook client) | `src/server/auctions/increments.ts` |
| Maximumbod-berekening, verlenging, herberekening (puur) | `src/server/auctions/engine.ts` (+ `engine.test.ts`) |
| Bieden, voorwaarden | `src/server/auctions/bidding.ts` |
| Publieke reads (`PublicLot`, `PublicBid`) | `src/server/auctions/public.ts` |
| Admin | `src/server/auctions/admin.ts` |
| Sluiten, tick | `src/server/auctions/closing.ts` |
| Meldingen | `src/server/auctions/notify.ts`, mails `src/emails/auctions/*`, builders `src/server/mail/builders-auctions.tsx` |
| Betaalpagina-service | `src/server/auctions/pay.ts` |
| LISTEN-verbinding | `src/server/auctions/realtime.ts` |
| SSE + polling | `src/app/api/auctions/[id]/stream/route.ts`, `src/app/api/auctions/[id]/lots/route.ts` |
| Jobs en cron | `src/server/auctions/jobs.ts` |

### Gelijktijdigheid
- `placeBid` is één transactie. Gelijktijdige biedingen op een kavel wachten op elkaar door `SELECT … FOR UPDATE` op de kavelrij. Andere kavels lopen gewoon parallel.
- De tijd komt uit de database: `clock_timestamp()` ná het verkrijgen van de lock.
- **Idempotentie**: elke submit draagt een `requestId` van de client (uniek per `lotId` + `requestId`). Een herhaling geeft de huidige stand terug, zonder tweede bod.
- **Wat er in de transactie gebeurt**:
  - de bid-rijen, de kavelupdate en de verlenging;
  - de outbid-job en, na een verlenging, een nieuwe `auctions.close-lot`-job;
  - `pg_notify('auction_<auctionId>', {"lotId": …})`, die pas bij de commit wordt afgeleverd.
- **Bid-rijen**: per submit een rij van de bieder zelf (`isAuto = false`, `maxAmount` = zijn maximum, `requestId`, hashes) en de zichtbare automatische tegenbiedingen (`isAuto = true`). De publieke geschiedenis laat een verhoging van het eigen maximum weg; dat is een rij met hetzelfde bedrag van dezelfde bieder.
- **Bod schrappen** (`voidBid`):
  - schrapt het doelbod en alle automatische rijen;
  - speelt de overgebleven submits opnieuw af (`replayBids`);
  - schrijft de nieuwe automatische rijen op hun oorspronkelijke tijdstip.

### Sluiten en cadans
- `auctions.close-lot`:
  - wordt per kavel gequeued met `startAfter = closesAt`: bij publiceren, bij herplannen en na elke verlenging;
  - sluit binnen ongeveer 2 s na de deadline (pg-boss pollt);
  - is idempotent: een kavel die door een verlenging nog niet "due" is, wordt overgeslagen.
- Cron `auctions.tick` (pg-boss, elke minuut, binnen de run elke 10 s, ~50 s lang). Dit is het vangnet als close-jobs ontbreken:
  - `PUBLISHED` → `LIVE` op `opensAt`;
  - alle kavels sluiten die al voorbij hun eindtijd zijn;
  - een veiling zonder open kavels → `CLOSED`;
  - "sluit bijna"-pushes (één keer per minuut);
  - holds van betaalde kavels vrijgeven en kavels met een elders geannuleerde order op `CANCELLED` zetten.
- Een kavel die bij het lezen al voorbij `closesAt` is, krijgt in `PublicLot` `closed: true`, ook als de sluiting nog niet is verwerkt.
- **Shop-cache**: `audit("auction.*")` ververst de catalogus-cache, behalve `auction.bid*`. Sluiten gebeurt in de worker. Daar werkt revalidate niet, dus een onverkocht stuk staat binnen de cachetijd van 60 s weer in de lijsten.

### Live verversen (SSE)
- `GET /api/auctions/<id>/stream` (`text/event-stream`) stuurt deze events:

  | Event | Inhoud | Wanneer |
  |---|---|---|
  | `snapshot` | `{ lots, serverTime }` | bij verbinden en na een reconnect van de listener |
  | `lot` | `{ lot, serverTime }` | per gecommitte wijziging |
  | `heartbeat` | `{ serverTime }` | elke 15 s |

  Streams stoppen na 25 minuten; EventSource maakt zelf opnieuw verbinding.
- Het endpoint toont alleen veilingen van de shop van de host, met status `PUBLISHED`, `LIVE` of `CLOSED`.
- **Polling-fallback**: `GET /api/auctions/<id>/lots` geeft `{ lots, serverTime, status }` terug.
- **LISTEN**: één eigen `pg`-verbinding per proces (niet uit de Prisma-pool), die alle kanalen `auction_<id>` combineert.
  - Bij verbindingsverlies probeert hij opnieuw (1 s tot 30 s). Daarna volgt een `snapshot`, omdat meldingen uit het gat verloren zijn.
  - Kavel-lookups van alle streams in een proces worden 300 ms gedeeld.
  - Met een PgBouncer in transaction mode werkt LISTEN niet. Zet dan `DATABASE_LISTEN_URL` op een directe of session-verbinding.
- **Ingress**: SSE mag niet gebufferd worden. `deploy/k8s/base/ingress.yaml` heeft al `nginx.ingress.kubernetes.io/proxy-buffering: "off"`, en de route stuurt `X-Accel-Buffering: no` mee. `proxy-read-timeout` is 60 s; de heartbeat van 15 s houdt de verbinding open.

### Betaallink
- Het token is `<lotId>.<HMAC(tenant, lot, order)>`, met een sleutel afgeleid van `APP_ENCRYPTION_KEY`. Er wordt niets opgeslagen.
- Het token werkt niet meer als de kavel geannuleerd is.
- **Flow**:
  1. `getAuctionPayView(tenantId, token)` laadt de pagina.
  2. `quoteAuctionPayment` berekent verzendopties en totalen.
  3. `submitAuctionPayment` schrijft adressen, verzending, toeslag en totaal op de order.
  4. Daarna start de normale `startOrderPayment(tenantId, orderId, { host })`.
- De Mollie-webhook en de finalizer verwerken de betaling zoals bij elke order: voorraad, `SOLD`, mails en factuur.

### Juridisch
Een online veiling is verkoop op afstand. De koper heeft 14 dagen herroepingsrecht; de winnaarsmail vermeldt dat. Laat de veilingvoorwaarden checken: zie het plan.
