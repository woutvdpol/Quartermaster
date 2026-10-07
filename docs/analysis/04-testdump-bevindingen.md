# 04 — Bevindingen testdump (Concept500 testshop)

Bron: phpMyAdmin-dump `main` (MariaDB 10.11), 07-10-2026, lokaal in `.local/` (niet in git). Geladen in tijdelijke container `qm-legacy-dump` (127.0.0.1:33307). Persoonsgegevens uit de dump zijn hier **niet** overgenomen.

## Omvang

| Tabel | Rijen | Opmerking |
|---|---|---|
| products | 970 | 22 ACTIVE, 948 INACTIVE (bulk-testdata, 945 zonder foto) |
| orders | 86 | 61 `manual`, 19 `paid` (2 gearchiveerd), 6 `failed` |
| order_details | 42 | 44 van 86 orders hebben **geen** regels |
| settings | 62 | |
| weights | 37 | 1 g – 30 kg |
| regions / region_weights | 2 / 3 | "Freeyo", "Pickup in store" |
| contents / content_pages / content_blocks | 24 / 2 / 5 | |
| users / addresses | 3 / 2 | |
| emailer_subscribers / emailer_mails | 5 / 4 | |
| payment_methods | 4 | Bank transfer, Cash, Mollie, Paypal (surcharge 5.00) |

`orders.payment_method`: BANK_TRANSFER 79, MOLLIE 4, CASH 1, leeg 2.

## Bevestigde datafouten

### 1. `order_details.price` = afgeronde regel-totaal in **hele euro's** ✅ bevestigd
| Order | `orders.total` | `delivery` | regels | product.price (centen) |
|---|---|---|---|---|
| 4 | 9462 | 5000 | `1 × 45` | 4462 |
| 27 | 14099 | 5000 | `2 × 89`, `1 × 2` | 4462, 175 |
| 16 | 5800900 | 100 | `1 × 58008` | 5800800 |

- Waarde is `Money::getAmount()` (bijv. `44.62`) in een `int`-kolom → afgerond (45). Centen gaan **verloren**; bij qty > 1 is het een regel-totaal (89 = 2 × 44,62).
- `orders.total` klopt wél (centen, incl. verzending).
- **ETL-gevolg:** regelprijs niet uit `order_details.price` halen. Reconstructie: `(orders.total − delivery − toeslag)` verdelen over regels naar verhouding van de afgeronde bedragen; markeer gereconstrueerde regels (`priceSource = "reconstructed"`).
- **Quartermaster:** `OrderLine.unitPrice` + `lineTotal` in minor units, plus snapshot van titel.

### 2. Orders zonder regels
44 van 86 orders hebben geen `order_details` (testorders/afgebroken flows). ETL: importeren als gearchiveerd met vlag `legacyNoLines`.

### 3. `products.photos` dubbel ge-JSON-encodeerd ✅ bevestigd
Opgeslagen als JSON-**string** die zelf JSON bevat: `"[\"65944cf5-…\",\"cfed22ae-…\"]"`. ETL: twee keer `JSON.parse`. IDs zijn Cloudflare Images-IDs → bij migratie downloaden naar lokale opslag (besluit: geen Cloudflare).

### 4. Slugs niet uniek
970 producten, 966 unieke slugs (`test` ×3, `dhdhdh` ×3). Quartermaster: `@@unique([tenantId, slug])` + automatisch suffix (`-2`).

### 5. Verzending: regio's zonder land
Regio's zijn vrije namen ("Freeyo", "Pickup in store") zonder landkoppeling; tarief in **decimal euro's** (`1.00`, `50.00`). Bevestigt besluit 21: vervangen door `ShippingZone{countries[]}` + staffels in centen, plus een aparte verzendmethode "Afhalen".

### 6. Statussen
- Alle producten `stock_control = RESERVED`; status is afgeleid, niet opgeslagen.
- `payment_status` vrij tekstveld; `manual` = onbetaalde overschrijving (telt nu mee in omzet).
- Er bestaat al een kolom `is_order_placed_event_fired` (latere fix tegen dubbele mails) — bevestigt dat order-afronding een bekend probleem is.

### 7. Valuta per order
`orders.currency` bestaat per rij; `exchange_rate`/`tax` leeg. Past bij besluit 17: valuta alleen weergave, opslaan in shopvaluta.

## Conclusie voor seed-data

De testdump is goed als **vorm-referentie** maar niet als seed: veel testrommel (`dhdhdh`, orders zonder regels, producten zonder foto's). Voorstel:
- Seed in Quartermaster = **handgemaakte, realistische fixture** (2 tenants, ±60 producten met lokale voorbeeldfoto's, ±40 orders in alle statussen, verzendzones Benelux/EU/Wereld).
- ETL-script (`scripts/etl`) wordt gebouwd en getest **tegen deze dump** (container `qm-legacy-dump`), met validatierapport — zodat het klaarstaat als de echte data later mee moet (besluit 23).
