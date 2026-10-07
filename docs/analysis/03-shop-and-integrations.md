# 03 — Shop-frontend & integraties (Concept500 → Quartermaster)

> Bron: `/Users/wout-intractief/Documents/Concept` (Laravel 12, Livewire 3, Backpack 6, Vite/SCSS/Tailwind/Bootstrap/jQuery).
> Scope: alles wat niet-admin is (publieke shop, checkout, betalingen, mails, jobs, SEO, hosting) plus de redesign-intenties.
> Doel: Next.js (App Router, RSC, Server Actions) + Prisma, nieuwe naam **Quartermaster**.
> Er zijn geen secrets overgenomen; env-keys worden alleen bij naam genoemd.

---

## 0. TL;DR

- De shop is een **single-tenant-per-installatie SaaS-product** ("Concept500"), verkocht met de abonnementen bronze/silver/gold. Er is één codebase met per klant een eigen deploy, DB, domein, settings-tabel en optioneel eigen CSS (`css.concept500.com/<host>.css`). Het is dus geen multi-tenant in één DB (zie §8).
- Bijna de hele frontend is Livewire. Het mandje zit in de server-sessie (file driver). De checkout is een wizard van 3 stappen (`spatie/laravel-livewire-wizard`).
- Betalen loopt via een Strategy-pattern: Mollie, PayPal en handmatig (bankoverschrijving of contant). **Kritiek:** de orderafhandeling (voorraad afboeken, bevestigingsmails, mandje legen) start pas bij een **GET op de return-URL** `/order/{uuid}`, niet vanuit de webhook. Komt de klant na betaling niet terug, dan krijgt hij geen mail en wordt de voorraad niet afgeboekt.
- Integraties: Mollie, PayPal (srmklive), Cloudflare Images (eigen Flysystem-adapter), Cloudflare Turnstile, CurrencyBeacon (via `ashallendesign/laravel-exchange-rates`), self-hosted Matomo (`stats.concept500.com`), Google Places (optioneel), SMTP/Mailgun (aparte `newsletter`-mailer), spatie/laravel-pdf (pakbon, alleen admin) en de Plesk Laravel-extensie.
- De scheduler doet bijna niets: alleen `sitemap:generate` draait dagelijks. Valuta updaten en oude producten archiveren zijn uitgecommentarieerd. Valuta wordt nu bijgewerkt via een **publieke, niet-geauthenticeerde GET** `/currency/update`.
- Militaria-specifiek bestaat al: `product_blur` (gevoelige items alleen voor ingelogde users, met 404 voor gasten), een age gate (cookie), de statussen `STOLEN`/`SOLD`/`RESERVED`, `ProductOrigin`/`PurchaseRecord` (herkomst/inkoop), `reserved_time` (soft-hold na add-to-basket) en een archiefpagina met verkochte items.

---

## 1. Page/route map

Legenda data: P=Product, C=Category, T=Tag, CP=ContentPage+ContentBlock, S=settings, Sess=sessie.

| # | URL (Laravel) | Methode | Doel | Data / logica | Next.js equivalent |
|---|---|---|---|---|---|
| 1 | `/` | GET | Home. Als `settings.home_shop` aan staat: CMS-pagina `ContentPage(url='Home')` met blocks, anders redirect naar `/shop` | CP, C (alleen als er een CATEGORIES-block is), P (bij TEXT_PRODUCT) | `app/(shop)/page.tsx` (RSC), `redirect()` als home uit staat |
| 2 | `/shop` | GET | Catalogus. Livewire `Shop` met filters/sort/pagination/"load more" via URL-state | P (filter), C (top-level, 60 min cache), T, Currency | `app/(shop)/shop/page.tsx` met `searchParams` → Prisma query (RSC). Filters als client component met `useRouter().replace` |
| 3 | `/shop/category/{slug}` | GET | Catalogus met voorgeselecteerde categorie | C via slug | `app/(shop)/shop/category/[slug]/page.tsx` (zelfde component, eigen canonical/meta) |
| 4 | `/shop/tag/{name}` | GET | Catalogus met voorgeselecteerde tag (op **naam**, niet op slug) | T via name | `app/(shop)/shop/tag/[slug]/page.tsx` (tag-slug invoeren) |
| 5 | `/archive` | GET | Archief: zelfde Shop-component met `type=archive` (`active=ARCHIVED`), alleen als `toggle_archive_page` aan staat | P archived | `app/(shop)/archive/page.tsx` |
| 6 | `/product/{id}` | GET | Redirect naar de canonical URL met slug | P | `app/(shop)/product/[id]/page.tsx` → `permanentRedirect` |
| 7 | `/product/{id}/{slug}` | GET | Productdetail met gallery (Swiper + Panzoom), related products, wishlist en add-to-basket. Geeft 404 als het item geblurd is en de bezoeker een gast is | P, related (handmatig → tags → categorie → nieuwste) | `app/(shop)/product/[id]/[slug]/page.tsx` + `generateMetadata` + JSON-LD |
| 8 | `/product/{id}/image/{image}` | GET | Losse beeldpagina (zoom) | P.photos | `app/(shop)/product/[id]/image/[imageId]/page.tsx` of een intercepting route `(.)image` als modal |
| 9 | `/shop.php?code=X` | GET | Legacy redirect (301) naar `/product/X` (oude shop-URL's) | — | `next.config.js` `redirects()` of middleware (de query `code` is nodig, dus middleware) |
| 10 | `/basket` | GET | Mandje (Livewire `Basket`): regels, regio kiezen → verzendkosten, door naar checkout | Sess.basket, Region, RegionWeight | `app/(shop)/basket/page.tsx` + Server Actions `removeFromBasket`, `setRegion` |
| 11 | `/basket` | POST | Add to basket (niet-Livewire fallback) | P | Server Action `addToBasket(productId)` |
| 12 | `/checkout` | GET | Gast: age-check of keuze login/gast (`shop-login`). Daarna wizard (contact → betaling → bevestiging). Zonder regio terug naar het mandje | Sess, PaymentMethod, Address | `app/(shop)/checkout/page.tsx` (gate) + `checkout/[step]/page.tsx` of één client-wizard met Server Actions per stap |
| 13 | `/checkout/guest` | GET | Zet `basket_login=true` in de sessie en gaat terug | Sess | Server Action `continueAsGuest()` |
| 14 | `/order` | POST | Order verwerken (wordt in praktijk via de wizard-confirm aangeroepen) | — | Server Action `placeOrder()` |
| 15 | `/order/{uuid}` | GET | Orderstatus/bedankpagina. **Hier wordt `OrderPlaced` gefired** | Order | `app/(shop)/order/[uuid]/page.tsx`, alleen lezen. Fulfilment verhuist naar de webhook |
| 16 | `/order/{id}/payment` | POST | Betaling opnieuw starten (numeriek id, enumereerbaar) | Order | Server Action `retryPayment(uuid)` |
| 17 | `/handle/mollie/{orderId}` | POST | Mollie-webhook (CSRF-exempt) | Mollie API | `app/api/webhooks/mollie/route.ts` |
| 18 | `/handle/paypal/{orderId}/{status}` | GET | PayPal return/cancel → capture | PayPal API | `app/api/payments/paypal/return/route.ts` + PayPal-webhook `PAYMENT.CAPTURE.COMPLETED` |
| 19 | `/emailer/activate/{id}/{token}` | GET | Double opt-in, bevestigpagina (form) | EmailerSubscriber | `app/(shop)/newsletter/confirm/page.tsx?token=` |
| 20 | `/emailer/activate` | POST | Activeren | — | Server Action |
| 21 | `/emailer/unsubscribe/{id}/{token}` | GET | Afmeldpagina | — | `app/(shop)/newsletter/unsubscribe/page.tsx` + `app/api/newsletter/unsubscribe/route.ts` (one-click POST, RFC 8058) |
| 22 | `/emailer/unsubscribe` | POST | Afmelden | — | idem |
| 23 | `/contact` | POST | Contactformulier (Turnstile) → `Mail::raw` naar `settings.email` | — | Server Action `submitContact` |
| 24 | `/{page}` | GET | Vaste contentpagina's (`ShopPageEnum`: about, terms, privacy, contact, links, events, news), aan/uit per setting | Content (nested set) | `app/(shop)/[page]/page.tsx` met `generateStaticParams` en whitelist |
| 25 | `/pages/{parent}/{child?}/{grandchild?}` | GET | CMS-pagina's met blocks (max. 3 niveaus) | CP | `app/(shop)/pages/[...slug]/page.tsx` |
| 26 | `/robots.txt` | GET | Dynamisch: `prevent_indexing` → alles disallowen | config | `app/robots.ts` |
| 27 | `/sitemap.xml` | static | Gegenereerd door cron in `public/` | P, C, T, CP | `app/sitemap.ts` (ISR, `revalidate`) |
| 28 | `/currency/update` | GET | **Publiek** valuta-update-endpoint | CurrencyBeacon | Weghalen. Wordt een cron-route met `CRON_SECRET` |
| 29 | `/login`, `/register`, `/forgot-password`, `/reset-password/{token}` | GET/POST | Auth. POST loopt via Backpack (`backpack.auth.login/register`), dus klanten en admins delen één users-tabel | User | Auth.js/Better Auth: `app/(auth)/login`, `register`, `forgot-password`, `reset-password/[token]` |
| 30 | `/logout` | GET | Uitloggen (via GET, CSRF-gevoelig) | — | Server Action (POST) |
| 31 | `/profile/*` | GET/PUT/DELETE | Account: dashboard, profiel, wachtwoord, adressen CRUD, orders, orderdetail, wishlist | User, Address, Order, wishlist pivot | `app/(account)/account/{page,profile,addresses,addresses/[id],orders,orders/[id],wishlist}` + Server Actions |
| 32 | `/api/user` | GET | Sanctum-voorbeeld, ongebruikt | — | Vervalt |

Admin-routes (`/admin/*`, Backpack) vallen buiten dit document (zie 02-admin).

---

## 2. User flows

### 2.1 Browse / filter / zoeken
- **Livewire `Shop`** met `#[Url]`-state: `selectedCategories[]`, `selectedTags[]`, `search`, `hide` (uitverkocht verbergen), `showPerPage` (+12 bij "load more", endless scrolling via setting), `sorting` (`featured|newest|oldest|highlow|lowhigh|lastupdated`) en `selectedMin/Max` (prijsrange, ion-rangeslider).
- `ProductFilterService`: `active=ACTIVE` (of `ARCHIVED` in het archief). Zoeken gebruikt `LIKE %q%` op title, id en description, dus geen fulltext. Een categorie omvat ook de directe children (één niveau). Tags via `whereHas`. Items met `NOT_IN_SHOP` en `qty=0` worden altijd uitgesloten. Bij prijssortering komt uitverkocht als laatste (`quantity=0`). "Featured" sorteert op `importance` (setting `toggle_product_importance`), daarna op `updated_at`.
- Header-`SearchBarComponent`: zet de zoekterm in de sessie en redirect naar `/shop`, waar `Shop::mount` hem uit de sessie haalt. In Next.js wordt dit gewoon `/shop?q=...`.
- Grid- of list-view in de cookie `shop_list_type`, met de default uit de setting.
- **Valuta**: de bezoeker kiest een valuta in de shop. `exchange_rate` gaat in de sessie en de prijzen worden **alleen weergegeven** omgerekend. De checkout en de betaling gaan altijd in `settings.currency`.
- Cachekeys zijn geprefixt met `shop_name` (bijv. `mijnshop_categories`). Dat bevestigt dat er meerdere installaties zijn die een cache-backend kunnen delen.

**Next.js-advies:** gebruik `searchParams` als de enige bron van waarheid en doe de Prisma-query in de RSC. Pagination is cursor- of offset-based, met "Load more" via `?limit=`. Voor search: Postgres `tsvector`/`pg_trgm`, of Meilisearch/Typesense als facetten (era/land/eenheid) belangrijk worden (zie §9).

### 2.2 Productdetail
- Canonical: `/product/{id}/{slug}`. De slug wordt automatisch uit de titel gemaakt (Backpack slug-field). Een verkeerde slug geeft 404 en **geen redirect** naar de juiste slug. Fix in Next: redirect naar de canonical.
- Gallery: Swiper plus modal met Panzoom (pinch-to-zoom-fix in #1342). Beelden komen uit Cloudflare Images: `imagedelivery.net/<hash>/<id>/<variant>`.
- Related products: handmatige relaties (`related_products` pivot, setting `related_products`), dan dezelfde tags, dan dezelfde categorie, dan de nieuwste. Max. 3, met filters op actief, op voorraad en niet `NOT_IN_SHOP`.
- Statusbepaling (`ProductStatusService`): ARCHIVED > SOLD > STOLEN > RESERVED > ACTIVE. RESERVED is ofwel een "recent in een mandje gelegd"-soft-hold, ofwel `stock_control=RESERVED` met `qty=0`.
- **Blur** (`settings.product_blur` en `product.blur`): voor gasten wordt de afbeelding in de lijst geblurd, de detailpagina geeft **404** en de checkout van een mandje met blur-items **dwingt login af** (de "age check" in `CheckoutController`). Dit is de huidige compliance-maatregel voor gevoelige symboliek.
- `NOT_IN_SHOP` met `qty=0` → toast "not available" en redirect naar home.

### 2.3 Wishlist
- Alleen voor ingelogde gebruikers: pivot `users ↔ products`, `WishlistService` attach/detach en een Livewire-`WishlistCounter`. Er is geen gast-wishlist.
- De admin-dashboard-chart "Most wishlisted" gebruikt deze data.
- **Next.js:** Prisma-model `WishlistItem`, Server Actions `toggleWishlist` en een optimistic UI (`useOptimistic`). Gast-wishlist in een cookie, gemerged bij login (nice-to-have).

### 2.4 Mandje (session-based)
- Sessie-key `basket` = `{productId: qty}`. `BasketDTO` berekent totaal, gewicht en aantal. De bedragen zijn `brick/money` in `settings.currency`.
- **Add**: geblokkeerd als `qty<=0`, `sold_on` gezet is, of het gevraagde aantal de voorraad overschrijdt. Ook geblokkeerd als het product **gereserveerd** is: `qty<=1` en `product_reserved_on` binnen `settings.reserved_time` seconden (keuzes 10s tot 45 min of langer, default 900s).
  - Bij add wordt `product_reserved_on=now()` gezet. Bij remove wordt hij `null`.
  - Er is **geen koppeling sessie↔reservering**. De reservering verloopt alleen door tijd, en verloopt ook terwijl het item nog in het mandje van de eerste klant ligt. Daardoor kunnen twee mensen hetzelfde unieke item afrekenen (zie §2.5).
- **Verzendkosten**: de klant kiest een `Region`. `RegionWeight` (pivot region↔weight met `delivery_charge`) levert de staffel. Gekozen wordt de eerste gewichtsgrens ≥ totaalgewicht, met fallback naar de hoogste staffel. Resultaat in de sessie: `delivery_charge` en `region`. Er is **geen koppeling regio↔land** van het adres, dus de klant kan een goedkopere regio kiezen dan zijn adres.
- Bij submit: controle op actief en voorraad, daarna `/checkout`. `direct_checkout`-setting: na add direct naar het mandje (de huidige code mist een `return`, dus deze redirect werkt niet).

**Next.js-advies:** gebruik een `Cart`-tabel in de DB (id in een httpOnly cookie, met `userId` optioneel na login) in plaats van server-sessiebestanden. Dat werkt serverless en stateless, en reserveringen zijn koppelbaar (`Reservation{productId, cartId, expiresAt}`). Prijs en verzendkosten altijd server-side herberekenen in de Server Action.

### 2.5 Checkout-wizard
De poort is `/checkout`:
1. Gast met blur-items in het mandje: login verplicht.
2. Gast zonder `basket_login`-flag: keuze login/registreren/"continue as guest".
3. Geen regio gekozen: terug naar het mandje.

Wizard (`OrderWizardComponent`). De state wordt in de sessie bewaard (`order_wizard_state`), browser back/forward wordt ondersteund via popstate (#1333) en de stap staat in de URL-history.

| Stap | Component | Velden / logica |
|---|---|---|
| 1. Contact | `ContactStepComponent` | voornaam, achternaam, telefoon (`propaganistas/laravel-phone`, alle landen), e-mail, adres, stad, state (feature-flag `STATE_FIELD_ENABLED`), postcode (regex per land in `CountryService`, nullable voor ~70 landen zonder postcode), land (`monarobase/country-list`), notities, akkoord met de voorwaarden. Validatie `NoFourByteCharacters` (geen emoji, i.v.m. MySQL utf8). Ingelogd: kies een opgeslagen adres. Optioneel: Google Places autocomplete (vanaf 6 tekens). |
| 2. Betaling | `PaymentStepComponent` | Actieve `PaymentMethod`s (Mollie, PayPal, Bank transfer, Cash) met een optionele **toeslag in %** (`surcharge`). |
| 3. Bevestiging | `ConfirmationStepComponent` | Overzicht. `confirm()` bouwt een `OrderDTO`: totaal = items + verzending, plus de toeslag (afgerond naar boven). Daarna `OrderController::process`. |

`OrderService::processOrder`:
- In een DB-transactie wordt per product met `lockForUpdate` gecontroleerd of `quantity ≥ gevraagd`.
- Daarna `Order` aanmaken (uuid, adres plat in de order, currency, total, delivery, payment_method, customer_id, notes, regionnaam) plus `OrderDetail`s (prijs = regel-totaal).
- **Voorraad wordt hier niet afgeboekt.** Dat gebeurt pas in de `UpdateStock`-listener na betaling, dus tot dan is overselling mogelijk.

### 2.6 Betaalflows

```
Wizard confirm ─► OrderService.processOrder ─► PaymentStrategyFactory(payment_method)
   ├─ MOLLIE ─► Mollie payments.create(amount, redirectUrl=/order/{uuid}, webhookUrl=/handle/mollie/{id} [alleen prod], metadata.order_id)
   │            └─► 303 naar Mollie checkout
   │            Webhook POST /handle/mollie/{id} (id=tr_xxx) ─► payments.get ─► isPaid ? status=paid : status=failed
   │            Klant keert terug op /order/{uuid} ─► als paid|manual en order_paid_on null ─► event OrderPlaced
   ├─ PAYPAL ─► createOrder(intent CAPTURE, return=/handle/paypal/{id}/success, cancel=/handle/paypal/{id}/canceled) ─► redirect naar approve
   │            return ─► capturePaymentOrder(token) ─► COMPLETED ? status=paid → /order/{uuid} : /basket + error
   └─ CASH / BANK_TRANSFER ─► status=manual ─► /order/{uuid} ─► OrderPlaced (mails, voorraad) ; admin zet later "paid" (/admin/order/paid/{id})
```

`OrderPlaced` → `UpdateStock` (voorraad −qty, `sold_on` bij 0) + `SendOrderPaidMails` (klant en eigenaar, idempotent via `email_sent_on`) + `ForgetBasketSession`.

**Gevonden problemen (meenemen als requirements):**
1. **Fulfilment hangt aan de return-URL (GET).** De webhook zet alleen de status. Klant sluit de tab → geen mail, geen voorraadafboeking en het item blijft verkoopbaar. In Next.js moet de fulfilment **idempotent in de webhook** zitten (DB-transactie + outbox/queue). De returnpagina leest alleen.
2. In de Mollie-webhook roept de `else`-tak `$order->update()` aan op een **int** (`$order` is het orderId). Dat is een `\Error` die niet gevangen wordt (alleen `\Exception` wordt gevangen), dus Mollie krijgt een 500 en blijft retryen. Daarnaast wordt elke niet-paid status (`open`, `pending`) als `failed` gemarkeerd.
3. De webhook-URL wordt alleen in productie meegegeven. Lokaal is dus alleen de return-flow testbaar (in Next: tunnel of Mollie-testmodus met een publieke preview-URL).
4. PayPal-foutpaden redirecten naar niet-bestaande routes (`cancel.payment`, `create.payment`) en geven dus een 500. Er is geen PayPal-webhook. `value` wordt zonder vaste decimalen meegegeven.
5. `/order/{id}/payment` gebruikt een numeriek id (enumereerbaar). Gebruik in Next de uuid en controleer de eigenaar of het sessie-token.
6. Toeslag en totaal worden berekend uit server-side sessiedata (goed), maar `paymentMethod` wordt niet gevalideerd tegen de **actieve** methodes.
7. Valuta: betaling altijd in de basisvaluta. De omgerekende weergave is een indicatie, maar dat staat nergens in de UI.

**Next.js-equivalent:**
- `@mollie/api-client` (officiële Node SDK): `payments.create`. Webhook-route `POST /api/webhooks/mollie` die de `id` uit de form-body leest en daarna **altijd** `payments.get(id)` doet (de payload is ongeauthenticeerd, dus re-fetch is het verificatiemodel).
- PayPal: `@paypal/paypal-server-sdk` (Orders v2) of rechtstreeks via REST/fetch. Return-route plus webhook met signature-verificatie (`verify-webhook-signature`).
- Overweeg **Mollie Orders API of alleen Payments plus methodes** (iDEAL, Bancontact, creditcard, **PayPal via Mollie**). Dan vervalt de aparte PayPal-integratie misschien helemaal (zie open vragen).
- Fulfilment via `fulfillOrder(orderId)` (idempotent, `SELECT … FOR UPDATE`, statusmachine `PENDING → PAID → FULFILLED`) en mails via de queue.

### 2.7 Orderbevestigingsmails
- `OrderConfirmation` (naar de klant, replyTo = shop-e-mail) en `OrderConfirmationOwner` (naar `settings.email`, replyTo = klant, met link naar de admin). Het zijn Markdown-mails (`mails/order-confirmed*.blade.php`).
- De vrije bevestigingstekst komt uit **`storage/app/custom_email.html`** (bestand op disk, via de admin aangepast). In Next naar de DB/settings verplaatsen.
- Bug: `from(config('setting.email'))` (typo `setting` in plaats van `settings`), dus valt dit terug op `MAIL_FROM_ADDRESS`.
- Er is een view `emails/orders/shipped.blade.php`, maar geen mailable of trigger. "Shipped"-mail is dus een gat (en een kans).
- **Next.js:** React Email + Resend, Postmark of SMTP (Nodemailer). Templates als TSX, verzonden vanuit de queue-worker.

### 2.8 Nieuwsbrief ("Emailer", double opt-in)
1. Er zijn twee aanmeldpunten: een CMS-block `EMAILER` (`EmailerComponent`) en een popup-modal (`EmailerModalComponent`, auto na 5 s, met een floating button). Beide hebben **Turnstile**. Uniek op e-mail, behalve als de status `unsubscribed` is (heraanmelding toegestaan).
2. `EmailerService::subscribe`: random 8-tekens `verification_code`, status `PENDING`, IP wordt gelogd. Daarna het event `EmailerSubscribed`, waarop `SendEmailerVerificationEmail` synchroon via de mailer `newsletter` verstuurt.
3. Link `/emailer/activate/{id}/{code}` → pagina met bevestigknop (POST, dus geen auto-activatie door mail-scanners). Status wordt `ACTIVE` en `email_verified_at` wordt gezet.
4. Versturen (admin): `SendEmailerMail::dispatchForMail` chunkt in batches van 200. Per subscriber gaat een `NewsletterMail` in de queue. De `emailer_quota`-setting (credits per abonnement) wordt afgeboekt.
5. Afmelden: link `/emailer/unsubscribe/{id}/{code}` (bevestigpagina + POST). Er staan headers `List-Unsubscribe` en `List-Unsubscribe-Post: One-Click`, **maar** het one-click-POST-endpoint op die URL bestaat niet (de route is GET, de POST verwacht body-velden). Dat is niet RFC 8058-conform en Gmail en Yahoo eisen het wel.
6. Het token is 8 tekens en wordt hergebruikt voor verify en unsubscribe. Het verloopt niet.

**Next.js:** `Subscriber`-model met een gehasht token (32+ bytes) en een expiry voor de verificatie. Een apart, stabiel unsubscribe-token (of HMAC-signed URL). `POST /api/newsletter/unsubscribe` als one-click. Bulkversturen via een queue (BullMQ of pg-boss) met rate limiting, of uitbesteden aan Resend Broadcasts, Mailgun of Brevo.

### 2.9 Leeftijdsverificatie
- `settings.age_verify` → full-screen overlay (Livewire), met de knoppen "≥18" (cookie `age_verified=1`, 1 jaar) of "nee". Dit is een **client-side gate**: de content staat al in de HTML en crawlers zien alles. Het is een juridische formaliteit, geen echte verificatie.
- Daarnaast is er de blur/login-eis voor gevoelige items (§2.2).
- **Next.js:** de middleware checkt de cookie en rewrite naar `/age-gate` (server-side, dus geen content-leak). Bots worden uitgezonderd of gaan via `noindex`, afhankelijk van de SEO-keuze. Optioneel echte leeftijdsverificatie (iDIN/Veriff) voor wapen-gerelateerde categorieën (zie §9).

---

## 3. Integraties

| Service | Doel | Huidige lib / implementatie | Node/Next.js-aanbeveling |
|---|---|---|---|
| **Mollie** | iDEAL/creditcard/Bancontact enz. | `mollie/laravel-mollie` ^3.1, Payments API, webhook `/handle/mollie/{id}` | `@mollie/api-client`. Route handler-webhook met re-fetch. Idempotente fulfilment |
| **PayPal** | PayPal-checkout | `srmklive/paypal` ~3.0 (Orders v2, CAPTURE). Return-URL-capture, geen webhook | `@paypal/paypal-server-sdk` of REST + webhook-verificatie. Alternatief: PayPal via Mollie |
| **Bankoverschrijving / contant** | Handmatig | Strategy zet `manual`. Admin markeert als betaald | Zelfde, plus betaalinstructies (IBAN + ordernummer als referentie) in de mail/pagina. Optioneel "betaal-link via Mollie" achteraf |
| **Cloudflare Images** | Productfoto's: opslag, varianten, CDN | Eigen Flysystem-adapter `CloudflareImagesAdapter/Uploader`. Batch-token upload (`batch.imagedelivery.net`), jobs `UploadProductPhotosJob`/`DeleteProductPhotosJob`. URL `imagedelivery.net/<hash>/<id>/<variant>` | Cloudflare Images REST via fetch. **Direct Creator Upload** (presigned, browser → CF), dus geen bestanden via de Node-server. `next/image` met een custom loader voor CF-varianten. Alternatief: R2 + Image Resizing |
| **Cloudflare Turnstile** | Botbescherming voor nieuwsbrief en contact | `ryangjchandler/laravel-cloudflare-turnstile` ^3 | `@marsidev/react-turnstile` client-side + server-side `siteverify` fetch in de Server Action |
| **Wisselkoersen** | Weergave in andere valuta (EUR/USD/GBP/AUD/JPY/CAD/CNY/NZD) | `ashallendesign/laravel-exchange-rates` ^7, driver **currency-beacon** (`EXCHANGE_RATES_API_KEY`). Koersen in de `currencies`-tabel. `brick/money` `CurrencyConverter` | Eenvoudige fetch naar CurrencyBeacon/ECB (ECB is gratis, EUR-basis, dagelijks) in de dagelijkse cron → `Currency`-tabel. `Intl.NumberFormat` voor formattering. Bedragen als integer minor units (`Decimal`/`BigInt` in Prisma, of `dinero.js`) |
| **Matomo** | Analytics (self-hosted `stats.concept500.com`, site-id per shop via `settings.matomo_id`). Dashboard-widget realtime visits (admin, `MATOMO_AUTH_TOKEN`) | Inline JS-snippet | `@socialgouv/matomo-next` of een `<Script>`-component. Server-side e-commerce-tracking (order) via de Matomo HTTP Tracking API vanuit de fulfilment-job. Cookieloos houden (AVG). Alternatief: Plausible/Umami |
| **Google Places** | Adres-autocomplete in de checkout (optioneel, `USE_GOOGLE_PLACES_API`) | Server-side calls naar de legacy Places Autocomplete/Details API | Places API (New) via een Route Handler (key server-side) of `@vis.gl/react-google-maps`. Voor NL beter: PDOK/postcode.tech (postcode + huisnummer) |
| **E-mail (transactioneel)** | Order- en contactmails, wachtwoord-reset | Laravel Mail SMTP (`MAIL_*`) | Nodemailer (SMTP) of Resend/Postmark + React Email |
| **E-mail (nieuwsbrief)** | Bulk | Aparte mailer `newsletter` (SMTP, default host Mailgun, `NEWSLETTER_MAIL_*`) | Queue-worker + Mailgun/Resend/Brevo API (betere bounce/complaint-webhooks) |
| **PDF** | Pakbon (alleen admin): `spatie/laravel-pdf` (Browsershot/Puppeteer, vandaar `puppeteer` in package.json) | `Pdf::view('pdf.package-slip')` | `@react-pdf/renderer` (geen Chromium nodig, serverless-proof) of Playwright/Puppeteer in de worker. Facturen bestaan nu **niet**, maar zijn voor NL-ondernemers met btw wel nodig (zie open vragen) |
| **Sitemap** | SEO | Eigen command (XML-writer, de `spatie/laravel-sitemap`-dep is ongebruikt), dagelijks → `public/sitemap.xml` | `app/sitemap.ts` (dynamisch + `revalidate`), eventueel `generateSitemaps` voor >50k URL's |
| **Telefoonvalidatie** | Checkout | `propaganistas/laravel-phone` (libphonenumber) | `libphonenumber-js` + Zod |
| **Landen / postcodes** | Checkout | `monarobase/country-list` + regex-tabel in `CountryService` | `i18n-iso-countries` + een regex-tabel (overnemen) of Google `libaddressinput`-data |
| **HTML-sanitizing** | CMS-content | `mews/purifier` (HTMLPurifier) | `isomorphic-dompurify` / `sanitize-html` server-side bij opslaan **en** bij renderen |
| **Toasts** | UX | `masmerise/livewire-toaster` | `sonner` |
| **Social share** | Facebook SDK (`socials-share`) | Inline FB SDK | Gewone share-links (geen third-party script, AVG) |
| **Plesk** | Hosting/deploy | `plesk/ext-laravel-integration` | Plesk Node.js-extensie, of weg van Plesk (zie §5) |
| **Cloudflare (proxy)** | `foodticket/laravel-cloudflare` (trusted proxies / real IP) | — | Next achter CF: `x-forwarded-for`/`cf-connecting-ip` uitlezen in de middleware |
| **Custom CSS per shop** | White-label-override | Layout doet bij **elke request** een blocking `get_headers()` naar `css.concept500.com/<host>.css` (alleen in prod) | Weg. Wordt theme-tokens in de settings plus een optioneel "custom CSS"-veld in de DB, als `<style>` gerenderd (gecachet) |

---

## 4. Background jobs & scheduler

### Huidig
| Taak | Mechanisme | Status |
|---|---|---|
| `sitemap:generate` | `routes/console.php` → `Schedule::daily()` | Actief (vereist een systeem-cron `schedule:run`) |
| `app:update-currencies-command` | Kernel | **Uitgecommentarieerd**. In de praktijk via de publieke GET `/currency/update` of automatisch als de basisvaluta wijzigt |
| `app:archive-old-products` (sold > 2 weken → ARCHIVED) | Kernel | **Uitgecommentarieerd** |
| `UploadProductPhotosJob` | Queue (`QUEUE_CONNECTION=database`), retries/backoff, curl_multi 100 parallel | Actief (admin/import) |
| `DeleteProductPhotosJob` | Queue, `afterCommit` | Actief |
| `SendEmailerMail` + `NewsletterMail` (ShouldQueue) | Queue, batches van 200 | Actief |
| Verificatiemail, ordermails | **Synchroon** in de request | — |
| Diverse one-off commands (`SyncCloudflareImages`, `ReorderPhotos`, `MigrateData`, `SyncProductPhotos`, …) | Handmatig | Migratietools, niet nodig in de nieuwe app (behalve als referentie voor de datamigratie) |

Een queue-worker (`php artisan queue:work`) moet op Plesk dus permanent draaien (supervisor of Plesk-scheduled task).

### Voorstel Node/Next.js
| Behoefte | Optie A: serverless (Vercel e.d.) | Optie B: VPS/container (aanbevolen bij Plesk/Hetzner) |
|---|---|---|
| Cron (valuta dagelijks, archiveren, reserveringen opruimen, abandoned-cart, "notify me"-digest) | `vercel.json` crons → `app/api/cron/*/route.ts`, beveiligd met `Authorization: Bearer ${CRON_SECRET}` | `node-cron` in de worker-proces, of systeem-cron → `curl` naar dezelfde cron-routes |
| Queue (mails, nieuwsbrief-batches, image-processing, fulfilment-outbox) | Inngest / Trigger.dev / Upstash QStash (HTTP-gebaseerd) | **pg-boss** (Postgres-only, geen Redis nodig) of **BullMQ** + Redis. Aparte `worker.ts` als tweede proces (PM2/systemd/docker-compose) |
| Sitemap | `app/sitemap.ts` met ISR, geen job | idem |
| Cache-invalidatie na admin-wijziging | `revalidateTag('products')` in de Server Action | idem |

Aanbeveling: **pg-boss** als de DB Postgres wordt (één dependency minder). Alle cron-taken als idempotente route handlers, zodat ze op elke host te triggeren zijn.

---

## 5. Hosting & deploy

### Huidig
- **GitLab CI** (`gitlab.com/macketmar/coloss/concept500`):
  - `build`-stage met `composer:2.3`-image: `composer run gitlab-ci-before`, `composer test` (PHPUnit, junit-rapport) en `composer archive` → zip-artifact.
  - Op tags: zip uploaden naar het **GitLab Generic Package Registry** plus een GitLab Release.
  - Er is geen automatische deploy naar de servers.
- **Server: Plesk** (`plesk/ext-laravel-integration`). De deploy is handmatig of via de Plesk Laravel Toolkit volgens `DEPLOYMENT_ACTIONS.md`: `optimize:clear` → `composer install --no-dev` → `npm ci && npm run build` → `config/route/view:cache` → `migrate --force` → `db:seed --class=NewSettingSeeder --force` → `optimize`.
- Per klantshop een eigen Plesk-domein, een eigen DB (MariaDB 10.11 lokaal via docker-compose) en een eigen `.env` (de complete `.env` staat in 1Password). Cache, sessie en queue zitten op de file/database drivers. `predis` is aanwezig, maar Redis is niet per se in gebruik.
- Lokaal: `docker-compose` (MariaDB + phpMyAdmin) en `php artisan serve` + Vite + queue + pail via `concurrently`.

### Opties voor Next.js
| Optie | Voor | Tegen |
|---|---|---|
| **1. Plesk Node.js-extensie** (bestaande servers) | Geen nieuwe infra, klanten blijven op dezelfde plek | Plesk + Node is beperkt (Passenger). Lastig met een worker-proces, Next-standalone-builds en zero-downtime |
| **2. Docker op een VPS** (Hetzner/DO) met **Coolify/Dokploy/Kamal**: `next start` (standalone) + worker + Postgres + (Redis), Caddy/Traefik, Cloudflare ervoor | Volledige controle, goedkoop, cron/queue triviaal, één compose-stack per shop of één multi-tenant-stack | Zelf beheren (backups, updates) |
| **3. Vercel/Netlify** + Neon/Supabase Postgres + Inngest/QStash | Snelste DX, previews per MR, edge-caching | Kosten per shop bij veel tenants, vendor lock-in, Mollie-webhooks naar previews vergen setup, langlopende jobs beperkt |
| **4. Cloudflare (OpenNext / Workers)** | Past bij de bestaande CF Images/Turnstile | Prisma op Workers vereist Accelerate/driver adapters. Minder volwassen |

**Advies:** optie 2 (container-image gebouwd in GitLab CI → registry → Coolify/Kamal-deploy, met `prisma migrate deploy` als release-stap), en kies voor **multi-tenant in één deployment** als het SaaS-model doorgaat (zie §8). GitLab CI-stages: lint/typecheck → test (Vitest + Playwright) → build image → deploy (tag = productie, main = staging).

---

## 6. SEO

| Aspect | Huidig | Opmerking / Next.js |
|---|---|---|
| Product-URL | `/product/{id}/{slug}`. Een foute slug geeft 404 | Id + slug behouden (stabiel, geen botsingen). **Redirect** bij een slug-mismatch. Oude `/shop.php?code=` → 301 behouden |
| Categorie | `/shop/category/{slug}` | Behouden. Hiërarchisch, bijv. `/shop/category/duitsland/helmen`, als nice-to-have |
| Tag | `/shop/tag/{name}` (rawurlencoded naam) | Tag-slug invoeren, met redirect vanaf de oude naam-URL's |
| Filter-URL's | `?selectedCategories[0]=3&selectedTags[]=…` (Livewire `#[Url]`), ook in menu-links (`RouteService`) | Leesbare params (`?cat=…&tag=…`). Canonical naar de categoriepagina. `noindex,follow` op gecombineerde filters |
| Meta | Title `"{shop_name} \| {page}"`, `meta description` per view (#1334). Product: OG, Twitter-card, `product:price:*`, canonical, **JSON-LD Product/Offer** | `generateMetadata` per route. JSON-LD uitbreiden met `brand`, `itemCondition` (Used), `BreadcrumbList` en `Organization` |
| Sitemap | Dagelijks statisch bestand. Bevat home, shop, archive (ook als die uit staat), actieve producten, categorieën, tags en contentpagina's. **Bug:** CMS-pagina's krijgen `/{url}` in plaats van `/pages/{url}`. ShopPageEnum-pagina's ontbreken | `app/sitemap.ts`. Image-sitemap (`<image:image>`) voor productfoto's (belangrijk voor collectors via Google Images) |
| Robots | Dynamisch. `APP_PREVENT_INDEXING` → disallow all + `X-Robots-Tag` + een "DEV SITE"-badge | `app/robots.ts` + middleware-header. Staging altijd `noindex` |
| Verkochte items | Blijven bereikbaar met status SOLD, en daarna in het archief (`/archive`) | Waardevol voor de long tail ("referentiedatabase"). Houden: indexeerbaar, `availability: SoldOut` |
| Geblurde items | 404 voor gasten, en dus ook voor Googlebot. Wel in de sitemap opgenomen (inconsistent) | Bewust kiezen: uit de sitemap en `noindex` |
| Performance | jQuery, Bootstrap, Popper van een CDN in de `<head>` (blocking). Google Fonts runtime-URL. Blocking `get_headers` | RSC + `next/font` (fonts uit de settings: `next/font/google` kan geen runtime-fonts, dus een whitelist van fonts of self-hosting) + `next/image` |
| i18n | Engelstalige UI, `lang` uit de app-locale. Geen hreflang | Overweeg `next-intl` (NL/EN/DE, gezien de doelgroep) |

---

## 7. Frontend-assets & redesign-intenties

**Huidig:** Blade + Livewire 3 + Alpine, Bootstrap 5 (CDN), jQuery 3.7 (CDN én lokaal), Tailwind 3 (alleen utility), SCSS (modulair: `base/`, `blocks/`, header/footer/homepage/general/package-slip/admin), Swiper 11, Panzoom, Lightbox2, ion-rangeslider. `resources/js/scripts.js` (~200 regels) bevat het menu, Panzoom-zoom en de Swipers.

**CMS-blocks** (`block-renderer.blade.php`, `ContentBlockTypeEnum`): `HERO`, `TEXT`, `TEXT_HORIZONTAL`, `TEXT_IMAGE`, `TEXT_PRODUCT`, `TEXT_CAROUSEL`, `QUOTE`, `CTA`, `GALLERY`, `TESTIMONIAL` (gegroepeerd in één Swiper), `CATEGORIES` (Swiper met categorieën), `NEW_ITEMS` (laatste N actieve producten) en `EMAILER`. In Next.js wordt dit een `BlockRenderer` met een discriminated union (`type`) → RSC-componenten. Alleen carousel, emailer en gallery zijn client components.

**Theming nu:** `<x-variables>` injecteert `primary_color` (default `#002E37`), `secondary_color` (`#208B85`), `tertiary_color` (`#EFEFEF`), `heading_font` en `text_font` uit de settings, via een groot blok hard-coded selectors. Favicons per abonnementsniveau (`public/favicon/{bronze|silver|gold}`). Logo en banner via settings (`banner_image` als CF-image).

**Redesign-intenties (`redesign.md` + `shop-redesign.html`):**
- Een semantisch tokensysteem `--cmd-*` dat runtime op de settings-kleuren mapt: `--cmd-primary` (accent, uit `secondary_color`!), `--cmd-secondary` (ink, uit `primary_color`), `--cmd-tertiary` (surface), plus `-dark/-light/-faint`-varianten, `--cmd-surface` en `--cmd-card-bg`. Let op de **verwarrende omkering** (primary ↔ secondary). Die rechttrekken in Quartermaster.
- Mockup-palet ("militaria/messing/leer"): primary `#C17F3B`, primary-dark `#9E6528`, primary-light `#E8C98A`, primary-faint `#FBF3E4`, secondary `#2C2316`, secondary-mid `#4A3B28`, secondary-light `#7A6248`, tertiary `#F5EDD8`, tertiary-dark `#EDE0C4`, tertiary-darker `#D9CCAD`, surface `#FDFAF4`, card `#FFFFFF`. Radius 4/8/12 px. Warme bruine schaduwen (`rgba(44,35,22,…)`), transition 0.22 s.
- Typografie: **Playfair Display** (headings, prijzen) + **Inter** (body).
- Pagina's en componenten: sticky header die bij scroll ~30% krimpt, met mobiele drawer, slide-in search, basket-hover-dropdown en badges. Footer met 3 kolommen en een nieuwsbrief-CTA. Homepage van blocks (hero met 60% overlay, CTA inverted, alternerende achtergronden). Shop met een sticky filter-sidebar (≤280 px) en een mobiele bottom-sheet, **active filter chips + "clear all"**, sorting inline met het aantal resultaten, en een grid `repeat(auto-fill,minmax(240px,1fr))`. Kaart met hover-lift, wishlist-overlay, "Sold"-badge en gedesatureerde afbeelding. Mandje 2/3 + 1/3 met een sticky samenvatting, **qty-stepper, undo-remove (3 s), couponveld (bestaat nog niet in de backend!), btw-regel**. Account met sidebar (mobiel tabs), adressen-grid met default-badge en orderstatus-badges. Een a11y-checklist (focus-visible, aria-labels, WCAG AA en loading states).
- **Vertaling naar Quartermaster:** tokens als CSS-variabelen in `:root`, server-side gerenderd vanuit `ShopSettings` (RSC in de `layout.tsx`). Tailwind v4 `@theme` die naar `var(--qm-*)` verwijst. shadcn/ui-componenten op die tokens. `next/font` met een beperkte fontkeuze.

---

## 8. White-label / multi-tenant: is het echt?

**Conclusie: ja, white-label is echt, maar het is "multi-instance", geen multi-tenant.**

Bewijs:
- Een abonnementsmodel in de code: `subscription_type` bronze/silver/gold → productlimieten (100/500/∞, of de override `maximum_items`), `emailer_quota`-credits, favicons per tier en de melding "Limit reached … upgrade your subscription … info@concept500.com" (#1320).
- Feedbackformulier in de admin "delivered straight to the Concept500 team". De footer linkt naar concept500.com en naar **MilitariaMart** (logo `mm.gif`), wat erop wijst dat de klanten militaria-dealers zijn die (ook) op MilitariaMart zitten.
- Centrale diensten voor alle shops: `stats.concept500.com` (Matomo, `matomo_id` per shop) en `css.concept500.com/<host>.css` (custom CSS per domein).
- Cachekeys geprefixt met `shop_name`, zodat meerdere installs een gedeelde cache kunnen gebruiken.
- `role`-veld op settings (`OWNER` vs `ADMIN`): de platformbeheerder (Concept500) ziet meer settings dan de shopeigenaar.
- Git-historie: issuenummers #1255 tot #1363 in GitLab-groep `macketmar/coloss`, en features als "subscription limits", "adjustable timezones" (#1348) en "currencies" (#1332) die alleen nuttig zijn voor meerdere klanten in verschillende landen. Tag-based zip-releases per versie.
- Er is **geen** `tenant_id`/`shop_id` in de tabellen. Eén DB en één `.env` per installatie.
- Zo'n 50 boolean/enum-settings als feature-toggles (archive, blur, age_verify, stolen status, importance, price range, SKU, related products, bump to top, packing slip prices, contact form, emailer popup, direct checkout, list/grid, endless scrolling, show price when sold, show tags, reserved time, timezone, currency, …).

**Implicatie voor Quartermaster:** de beslissing hangt af van de vraag of Quartermaster één shop (de eigen militariawinkel) wordt of opnieuw een platform.
- Eén shop: settings → een `ShopSettings`-singleton, de meeste toggles schrappen en abonnementslogica weg.
- Platform: echte multi-tenancy (`tenantId` op alle modellen + Prisma-extension/RLS in Postgres, tenant-resolutie via de host in de middleware, theming per tenant uit de DB). Dat is goedkoper te hosten dan N installaties.

---

## 9. Innovatie-ideeën voor een militaria-collectorshop

Waarde: H/M/L (business- en collector-impact). Effort: S (≤2 d), M (≤1 wk), L (>1 wk).

| # | Idee | Toelichting | Waarde | Effort |
|---|---|---|---|---|
| 1 | **Gestructureerde taxonomie: periode/conflict, land, krijgsmachtdeel, eenheid, type, maker/markering** | De huidige categorieën en tags zijn vrij en plat (één niveau children). Facetten maken filteren als "WO2 › Duitsland › Heer › Helmen › M40" mogelijk. Prisma: `Facet`/`FacetValue` met hiërarchie, plus Postgres-indexen of Meilisearch voor facet counts | H | M–L |
| 2 | **Herkomst & certificaat van echtheid (COA)** | `ProductOrigin`/`PurchaseRecord` bestaan al (inkoop/herkomst, alleen admin). Uitbreiden met publieke provenance-velden (collectie-historie, veteraan-groupings, documenten/scans) en een **PDF-COA** met QR → verificatiepagina `/verify/{code}` (signed). Een garantie-van-echtheid-policy (levenslang terugnemen bij een bewezen replica) is een sterke USP | H | M |
| 3 | **Rijke beeldervaring** | Deep zoom (Cloudflare-varianten tot 4K + Panzoom of OpenSeadragon) voor markeringen en stempels. Vergelijk-modus (2 foto's naast elkaar), detailfoto-labels ("maker mark", "liner") en schaal-referentie | H | S–M |
| 4 | **"Notify me" / saved searches / nieuwe-aanwinsten-alerts** | De klant slaat een filtercombinatie op (bijv. "Land=NL, Periode=1940-45") en krijgt een mail bij een nieuw product dat matcht (dagelijkse digest of direct). Hergebruikt de nieuwsbrief-infra. Grootste conversiedriver voor unieke items die snel weg zijn. Ook "notify bij prijsverlaging" op wishlist-items | H | M |
| 5 | **Echte reservering / layaway** | Nu is er een soft-hold op productniveau zonder koppeling aan de sessie (§2.4). Nieuw: `Reservation{cartId, productId, expiresAt}` met countdown in het mandje en auto-release via cron. Plus **layaway** (aanbetaling X%, termijnen via Mollie-betaallinks, item op "RESERVED" voor N weken), wat gangbaar is bij dure militaria | H | M (reservering) / L (layaway) |
| 6 | **Bieden / "make an offer"** | Per product een `acceptsOffers`-vlag. De klant doet een bod en de admin accepteert, weigert of doet een tegenbod. Bij acceptatie volgt een persoonlijke checkout-link met de geldende prijs (Server Action + signed token, verloopt na 48 u) | M–H | M |
| 7 | **Veilingmodule** (light) | Tijdgebonden biedingen op topstukken, met anti-sniping (+2 min verlenging). Realtime via SSE of Pusher. Juridisch: AV en kopersbescherming | M | L |
| 8 | **Multi-currency checkout** | Nu alleen weergave. Mollie ondersteunt betalingen in GBP/USD/CHF enz. Settlement blijft EUR. Prijs vastzetten in de gekozen valuta met de dagkoers + marge. Toon "Je betaalt in EUR" zolang dat niet zo is | M | M |
| 9 | **Compliance per land: symbolenweergave** | Duitsland (§86a StGB), Oostenrijk (Verbotsgesetz), Frankrijk en anderen beperken de weergave van NS-symbolen. Gebruikersland bepalen via CF-header `cf-ipcountry` + verzendland. Per product `restrictedSymbols` → automatisch blur/retouche-variant (Cloudflare Images-variant of handmatig een tweede foto), niet verzenden naar bepaalde landen (checkout-blokkade per categorie × land), en een disclaimer ("historisch/educatief"). Huidige blur = alleen login | H (juridisch risico) | M |
| 10 | **Exportbeperkingen & wapenwetgeving** | Gedemilitariseerde wapens, munitie(-delen) en blanke wapens: per categorie een flag `requiresAgeVerification`/`requiresDeactivationCert`/`noShipTo[]`. Deactivatiecertificaat (EU 2018/337) als verplichte upload/weergave | H | M |
| 11 | **Echte leeftijdsverificatie** | Nu cookie-klik. Server-side gate in de middleware (§2.9). Voor gevoelige categorieën bij de checkout iDIN (NL), Veriff of Yoti, of "18+ bevestigd" opslaan op het account | M | S (gate) / M (iDIN) |
| 12 | **Referentie-archief als SEO- en community-asset** | Het archief met verkochte items bestaat al. Maak er een doorzoekbare referentiebibliotheek van ("sold for €X" optioneel, foto's blijven). Trekt verzamelaars die willen identificeren of waarderen. Gestructureerde data + image-sitemap | M–H | S |
| 13 | **Verzending verbeteren** | Regio automatisch afleiden uit het land (nu een handmatige keuze, manipuleerbaar). Verzekerde verzending als optie (waarde-afhankelijk). Track & trace (Sendcloud/MyParcel-API) + de "shipped"-mail (view bestaat al, maar wordt niet gebruikt) | H | M |
| 14 | **Facturen + btw-margeregeling** | Tweedehands/antiek valt vaak onder de **margeregeling** (geen btw op de factuur). Automatische PDF-factuur bij betaling, bijlage bij de mail, nummering. Nu is er alleen een pakbon | H (administratie) | M |
| 15 | **Klantaccount: verzamelingen / wishlist delen / "items like this"** | Wishlist-alerts (prijsdaling, gereserveerd → weer beschikbaar). Recent bekeken. Aanbevelingen via facet-similarity | M | S–M |
| 16 | **Inruil/inkoop-formulier** | "Verkoop uw collectie": formulier met foto-upload (CF Direct Upload) → lead in de admin, gekoppeld aan `PurchaseRecord` | M | S |
| 17 | **Marketplace-sync** | Export naar MilitariaMart of eBay (feed of API), voorraad synchroon zodat er geen dubbele verkoop is | M | L |
| 18 | **Coupons/kortingscodes** | Gevraagd in het redesign (basket-couponveld), maar er is geen backend | M | S–M |
| 19 | **Abandoned-cart-mail** (alleen ingelogd, met opt-in) | Cart in de DB maakt dit mogelijk | M | S |

---

## 10. Overige observaties (bugs/tech-debt, relevant voor de migratie)
- `direct_checkout`: `redirect('/basket')` zonder `return`, dus de redirect werkt niet.
- `/logout` via GET, `/currency/update` publiek (DoS of API-quota-verbruik).
- `config('setting.email')`-typo in drie mailables.
- Postcode-verplichting op landnaam (`required_unless:country,<namen>`) terwijl het veld een landcode is. Even verifiëren of dit klopt.
- `NoFourByteCharacters`: emoji worden geweigerd vanwege de MySQL-charset. In Postgres/utf8mb4 is dat niet nodig.
- `ContentController` geeft bij een onbekende pagina een redirect naar `/` met een flash in plaats van een 404 (soft-404, slecht voor SEO).
- `Basket::render` logt de verzendkosten bij elke render (`Log::info`).
- Testdekking: alleen `tests/Unit` en `tests/Livewire`. Feature tests staan uit.

---

## Open vragen

1. **Platform of eigen shop?** Wordt Quartermaster één shop (de eigen militaria-business) of opnieuw een white-label SaaS voor meerdere dealers (zoals Concept500)? Dit bepaalt multi-tenancy, settings-omvang, abonnementslogica en hosting.
2. **Datamigratie bestaande klanten:** moeten de huidige Concept500-installaties (hoeveel?) naar Quartermaster gemigreerd worden, inclusief orders, klantaccounts (wachtwoord-hashes bcrypt → compatibel met de Node-auth?) en Cloudflare Images-id's?
3. **URL-compatibiliteit:** moeten `/product/{id}/{slug}`, `/shop/category/{slug}`, `/pages/...` en de legacy `/shop.php?code=` 1-op-1 behouden blijven, of mag het naar nieuwe URL's met 301's?
4. **Betaalproviders:** blijft PayPal een aparte integratie, of gaat het via Mollie (minder code, één webhook)? Zijn contant en bankoverschrijving nog nodig? Moet afrekenen in vreemde valuta (echte multi-currency) mogelijk zijn?
5. **Facturen & btw:** is er behoefte aan automatische facturen (margeregeling of gewone btw)? De btw-regel in het redesign-mandje suggereert dat er btw-weergave nodig is.
6. **Reserveringsbeleid:** hoe lang mag een item in het mandje "vast" staan en moet de reservering aan het mandje gekoppeld zijn (bijv. 15 min met countdown)? Is layaway of aanbetaling gewenst?
7. **Compliance:** naar welke landen wordt verkocht en welke categorieën (NS-symboliek, gedeactiveerde wapens, blanke wapens) vereisen weergave- of verzendbeperkingen? Moet de blur-voor-gasten-aanpak blijven, of wordt het geo-based?
8. **Leeftijdsverificatie:** is een klik-gate (server-side) voldoende, of is echte verificatie (iDIN e.d.) nodig voor bepaalde categorieën?
9. **Hosting:** moet het op de bestaande Plesk-servers blijven, of mag het naar containers (Coolify/Kamal op een VPS) of Vercel? Wie beheert het?
10. **Database:** MariaDB behouden of overstappen naar Postgres (aanbevolen: pg-boss, fulltext/trigram en betere Prisma-features)?
11. **Analytics:** blijft de centrale Matomo (`stats.concept500.com`) in gebruik, en heeft Quartermaster daar toegang toe?
12. **Nieuwsbrief:** zelf blijven versturen via SMTP/Mailgun met de quota-logica, of een dienst (Resend Broadcasts, Brevo, Mailchimp) met import van de bestaande double-opt-in-subscribers (bewijs van opt-in: IP + timestamp zijn aanwezig)?
13. **Talen:** alleen Engels (huidige UI), of NL/DE/EN met hreflang?
14. **Custom CSS per domein** (`css.concept500.com`): wordt dat nog gebruikt, en welke shops hebben er een?
15. **Auth:** moeten klant- en admin-accounts in één users-tabel blijven (nu Backpack) of gescheiden worden? Social login gewenst?
16. **Welke innovatie-items** (§9) zijn MVP en welke post-launch? Voorstel MVP: 1 (taxonomie light), 3, 4, 5 (reservering), 9/10 (compliance-flags), 13 (regio afleiden + shipped-mail), 14 (facturen).
