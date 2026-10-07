# ETL — facturen, verzending (fulfillment) en wisselkoersen

Gebied: admin-ops (fase 5). Bron: Concept500 (`.local/main.sql`, zie `docs/analysis/02-data-model.md`).

## Facturen (`Invoice`)
- **Niets te migreren.** Concept500 kent geen verkoopfacturen: alleen een pakbon (packing slip, met optioneel prijzen via `toggle_packing_slip_prices`). `purchase_records.invoice_number` is een *inkoop*factuur en hoort bij purchasing, niet hier.
- ETL maakt **geen** `Invoice`-rijen voor legacy orders en laat de sequence `invoice.number` leeg → de eerste factuur na livegang krijgt nummer 1 (weergave `INV-{jaar}-000001`).
- Legacy orders krijgen `finalizedAt` gezet (anders zou een latere finalisatie alsnog een factuur aanmaken); de automatische uitgifte loopt alleen via `onOrderFinalized()` → job `invoices.issue`.
- Wil de eigenaar toch een factuur voor een oude betaalde order: knop "Issue invoice" op de orderpagina (krijgt gewoon het volgende nummer).
- Btw-regeling: standaard `MARGIN` (margeregeling, geen btw-bedrag op de factuur). Instelling per shop volgt later.
- Ontbrekende instellingen voor de factuurkop (nu weggelaten als leeg): `general.cocNumber` (KvK), `general.vatNumber` (btw-id), `general.iban`. Concept500 heeft deze niet in `settings`; bij de ETL handmatig laten invullen (Instellingen → General → Business details).

## Verzending (`Order.fulfillmentStatus`, carrier/tracking)
Concept500 heeft **geen** verzendstatus, vervoerder of track & trace (geen kolommen; `delivery_address` is ongebruikt). Afleiden bij de ETL:

| Legacy situatie | `fulfillmentStatus` | Overig |
|---|---|---|
| Betaald (`payment_status = paid`; `manual` telt nooit als betaald, ook niet mét `order_paid_on`) **en** (`archive = 1` of `order_paid_on` > 14 dagen vóór de migratiedatum) | `DELIVERED` | `shippedAt`/`deliveredAt` = `null` (onbekend); `legacyData.fulfillmentInferred = true` |
| Betaald, niet gearchiveerd, betaald ≤ 14 dagen geleden | `UNFULFILLED` | Verschijnt op het verzendbord onder "To pack" zodat de eigenaar het zelf afvinkt |
| Niet betaald (`failed`, `manual` zonder betaaldatum) | `UNFULFILLED` | — |

- `carrier`, `trackingNumber`, `trackingUrl` blijven `null`.
- De ETL schrijft direct in de database: er gaan **geen** "shipped"-mails uit (die worden alleen via de fulfillment-service bij een statusovergang verstuurd, met een `shipped_mail_queued`-event als claim).
- Het verzendbord toont in "Shipped" alleen orders met `shippedAt` in de laatste 14 dagen; gemigreerde `DELIVERED`-orders zonder `shippedAt` blijven daar dus buiten.

## Wisselkoersen (`ExchangeRate`)
- Legacy `currencies` (code + `exchange_rate` decimal(8,2), t.o.v. de shopvaluta, te weinig precisie) wordt **niet** gemigreerd.
- `ExchangeRate` is platformbreed (basis EUR) en wordt gevuld door de ECB-job (`cron.rates.refresh`, dagelijks 15:30 UTC, en bij workerstart als er geen actuele koersen zijn).
- Wel migreren (hoort bij settings-ETL): de lijst actieve valuta → `general.displayCurrencies` (alleen codes uit `DISPLAY_CURRENCIES`, zonder de shopvaluta). Legacy rate 0 = "nog nooit opgehaald" en is irrelevant.
- `orders.exchange_rate` (ongebruikt, altijd 100) wordt genegeerd.
