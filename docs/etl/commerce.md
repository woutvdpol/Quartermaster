# ETL — Commerce: biedingen, kortingscodes, verlaten winkelwagen

Fase 5-onderdelen: `Offer`, `Coupon`, `CouponRedemption`, `Order.discountTotal/couponCode/offerId`,
`Cart.couponCode/email/reminderConsent/abandonedMailSentAt`, `CartItem.offerId`.
Bronnen: `docs/analysis/02-data-model.md`, `.local/main.sql`.

## Biedingen (`Offer`)
**Geen legacy-data — nieuwe functie.** Concept500 heeft geen biedingen-tabel. De ETL maakt geen
`Offer`-rijen aan.
- `Product.acceptsOffers`: geen legacy-veld → `false`. Wil de eigenaar biedingen voor de hele shop,
  dan zet hij **Settings → Catalog → "Allow offers by default"** (`catalog.allowOffersDefault`) aan;
  biedingen zijn mogelijk als `product.acceptsOffers || catalog.allowOffersDefault`.
- `Order.offerId`: altijd `null` voor gemigreerde orders.

## Kortingscodes (`Coupon`, `CouponRedemption`)
**Geen legacy-data — nieuwe functie.** Concept500 kende geen kortingscodes; geen rijen aanmaken.
- Gemigreerde orders: `discountTotal = 0`, `couponCode = null`.
- Let op de DB-check `orders_amounts_check`: `0 ≤ discountTotal ≤ subtotal`.
- Omzet/marge (dashboard + margerapport) = `subtotal − discountTotal`; met `discountTotal = 0` is dat
  voor legacy-orders gelijk aan het subtotaal.

## Order-bedragen uit legacy
- `orders.total` (incl. verzending) → `Order.total`; `orders.delivery` → `Order.shippingTotal`;
  `subtotal` = Σ regelbedragen (zie orders-ETL).
- `orders.tax`: wordt in Concept500 nooit gevuld → **negeren** (geen kolom in het nieuwe model).
- `orders.exchange_rate` (int, default 100): ongebruikt → **negeren**. Orders zijn altijd in de
  shopvaluta (`orders.currency` → `Order.currency`).
- Betaalmethode-toeslag (`payment_methods.surcharge`, een percentage): als het verschil
  `orders.total − (Σ regels + delivery)` > 0 is, is dat de toeslag → `Order.surchargeTotal`
  (minor units). Is het verschil 0, dan `surchargeTotal = 0`. Formule moet blijven kloppen:
  `total = subtotal − discountTotal + shippingTotal + surchargeTotal`. Een negatief verschil
  (afrondingsbug `order_details.price`) niet als toeslag boeken maar in `legacyData` loggen.

## Winkelwagens
**Niet migreren.** Legacy-winkelmandjes leefden in de sessie; er is niets om over te zetten.
`Cart.email/reminderConsent/abandonedMailSentAt/couponCode` en `CartItem.offerId` krijgen hun
defaults (`null`/`false`).
- Herinneringsmails gaan alleen naar winkelwagens met expliciete toestemming (checkbox in de
  checkout); geen enkele legacy-toestemming geeft hier recht op.
