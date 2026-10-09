# Beursmodus

Verkopen op een beurs met de telefoon of tablet. Besluiten: `docs/02-besluiten.md`, "Innovatieronde 2".
Ontwerp: `docs/design/fair-archive-push-network/` (boards Main en FairSetup).

## Verloop

1. **Voorbereiden** (`/admin/fairs` → nieuwe beurs). Kies de stukken die mee gaan. Alleen stukken die te koop
   zijn (ACTIVE, op voorraad) kunnen op een beurs. Per stuk staat een **minimumprijs** (floor). Standaard is dat
   de lijstprijs −15%, afgerond (onder €20 op €1, onder €100 op €5, onder €1.000 op €10, daarboven op €50).
   Een lege floor betekent: niet onder de lijstprijs.
2. **QR-labels** printen (PDF): A4-vel 3 × 8 (70 × 37 mm), labelprinter 62 mm of hangkaartjes 50 × 30 mm.
   De prijs op het label is optioneel. De QR bevat de publieke productlink op het primaire domein
   (`https://<domein>/product/<voorraadnummer>`). Wie hem scant ziet de productpagina. De beursmodus haalt het
   voorraadnummer uit die link.
3. **Beurs starten.** Status wordt LIVE. Staat "verbergen in de webshop" aan, dan krijgen de onverkochte stukken
   `Product.fairHoldId`. Ze verdwijnen dan uit lijsten, zoeken, sitemap en de Merchant-feed. Een winkelwagen kan
   ze niet reserveren. De productpagina blijft bereikbaar (voor wie de QR scant), maar toont het stuk als
   gereserveerd.
4. **Verkopen** op `/admin/fair/<id>` (knop "Open fair mode"). Dit vraagt een gewone beheerderslogin; er zijn geen
   helper-logins. Je scant de QR met de camera (BarcodeDetector) of typt het nummer. Daarna vul je de prijs in en
   kies je pin, contant of factuur. Een e-mailadres van de koper is optioneel. Onder de floor verkopen kan alleen
   met een extra vinkje.
5. **Beurs beëindigen.** Status wordt ENDED en alle holds worden opgeheven. Onverkochte stukken zijn nooit van
   ACTIVE af geweest en staan dus meteen weer online. Het rapport toont:
   - omzet, uitgesplitst naar pin, contant en factuur;
   - marge (prijs − inkoopprijs);
   - gemiddeld verschil met de lijstprijs;
   - laatste verkopen;
   - hoeveel contant geld er in de kas hoort te zitten.

## Wat een beursverkoop doet

Elke verkoop is een gewone order (`channel = FAIR`, `fairId`, afhalen) in **één transactie**:

- **Pin of contant:** MANUAL-betaling, status PAID. Daarna dezelfde afronding als elke betaalde order
  (`finalizeOrderTx`): voorraadmutatie SALE, product SOLD, andere reserveringen vrij, bevestigingsmails en een
  factuur-job. Een certificaat maak je zoals altijd op de productpagina in de admin.
- **Factuur:** order PENDING. De koper neemt het stuk mee, dus de voorraad gaat meteen af en het product wordt
  SOLD. Zet je de order later op betaald ("Mark as paid"), dan volgen mails en factuur. De voorraad wordt dan
  niet nog een keer afgeboekt (de afronding slaat al geboekte SALE-mutaties van de order over). Annuleer je zo'n
  order, dan zet je de voorraad zelf terug.
- `FairItem` krijgt de verkoopprijs, het tijdstip en de order. Alles wordt geaudit (`fair.*`), waardoor de
  shop-cache van de catalogus direct wordt ververst.
- Geweigerd met een duidelijke melding:
  - het stuk is al verkocht of staat niet op de beurs;
  - het stuk ligt in een webshop-order die op betaling wacht;
  - het stuk staat op een andere live beurs;
  - de prijs ligt onder de floor zonder vinkje.
- Zonder e-mailadres krijgt de order het adres `fair-buyer@fair.invalid`. Mails daarheen worden overgeslagen.
  De eigenaar krijgt wel de gewone ordermail.

## Offline

- Bij het openen wordt de stuklijst van de beurs opgeslagen (IndexedDB, met localStorage als terugval). Opzoeken
  werkt daarna ook zonder verbinding.
- Elke verkoop krijgt op het toestel een `clientRef` (`crypto.randomUUID`). Hij gaat eerst in de wachtrij en
  wordt dan verstuurd naar `POST /admin/fair/<id>/sales`. Zonder verbinding toont de kop
  "Offline · N sales waiting to sync". Zodra er weer verbinding is, worden de verkopen verstuurd, met oplopende
  wachttijd tussen pogingen.
- De server is idempotent op `clientRef` (`Order @@unique([tenantId, clientRef])`). Een verkoop die twee keer
  aankomt, geeft de bestaande order terug en wordt nooit dubbel verkocht.
- Weigert de server een verkoop (bijvoorbeeld omdat het stuk intussen online is verkocht), dan komt die onder
  "Needs attention" en wordt hij niet opnieuw geprobeerd.
- Is de sessie verlopen, dan stopt het versturen tot je opnieuw inlogt.
- Er is geen service worker. Open de pagina dus één keer met verbinding voordat je offline gaat, en herlaad
  haar niet zonder verbinding.
- Een beurs die al beëindigd is, accepteert nog verkopen uit de wachtrij.

## Code

- Service: `src/server/fairs/` (`index.ts`, pure logica in `pure.ts` en `queue.ts`, labels in `labels-pdf.tsx`).
- Admin: `src/app/admin/(app)/fairs/` (lijst, detail, labels-route).
- Telefoon: `src/app/admin/fair/[id]/` (pagina, client, sync-route). De camera is alleen op dit pad toegestaan
  (`Permissions-Policy` in `src/proxy.ts`).
- Shop-zichtbaarheid: `fairHoldId IS NULL` in `VISIBLE_SHOP` (`src/server/storefront-catalog/queries.ts`),
  `src/server/seo/queries.ts` en `src/server/storefront/products.ts`. Reserveren wordt geblokkeerd in
  `src/server/stock/reservations.ts`.
