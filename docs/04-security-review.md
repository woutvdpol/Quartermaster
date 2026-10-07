# Security-review (07-10-2026)

Gerichte review vóór livegang (backlog #12): auth, sessies/cookies, CSRF, uploads, webhooks, autorisatie per actie, SSRF, XSS, open redirects, rate limits, headers. Ernst: **Hoog / Middel / Laag / Info**. Status: ✅ opgelost in deze ronde · ⏳ open · ℹ️ geaccepteerd/documentatie.

## Samenvatting

- Geen kritieke bevindingen. De enige **hoge** bevinding (R1: gastorders koppelen via een niet-geverifieerd e-mailadres) is opgelost.
- Backlog #4–#11 zijn uitgevoerd (zie `03-security-backlog.md`); details hieronder.
- Geen schemawijzigingen/migraties nodig.

## Open bevindingen

| # | Ernst | Bevinding | Voorstel | Status |
|---|---|---|---|---|
| R1 | **Hoog** | Registratie en e-mailwijziging koppelden direct de gast-`Customer` (orders, adressen, verlanglijst, nieuwsbrief) van het opgegeven adres, terwijl `emailVerifiedAt` nog `null` was; de orderlijst toonde ook ongekoppelde orders op e-mail. | Opgelost, zie "R1 — koppelen pas na bewezen e-mailadres" hieronder. | ✅ |
| R2 | Middel | Geen Content-Security-Policy op HTML-pagina's (alleen op `/uploads`, documenten en unsubscribe). Geen XSS gevonden; CSP is extra verdediging. | Via `src/proxy.ts`, eerst als `Content-Security-Policy-Report-Only`: `default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`. `'unsafe-inline'` is nodig zolang er geen nonces zijn (nonces dwingen dynamisch renderen af — apart besluit). Let op: Mollie-checkout is een top-level navigatie, dus `form-action` blokkeert die niet. | ⏳ |
| R3 | Laag | Mollie-webhook vergelijkt bedrag/valuta/mode van de opgehaalde betaling niet met de `Payment`-rij vóór "PAID" (`src/server/orders/commands.ts` ~297). Nu niet uitbuitbaar (bedrag komt altijd uit de order). | Bij afwijking loggen en niet op PAID zetten; mode (test/live) op `Payment` vastleggen. | ⏳ |
| R4 | Laag | Ongeauthenticeerde Mollie-webhook doet voor elk geldig `tr_…`-id een API-call met de sleutel van de tenant (quota-uitputting). | Eerst `Payment` (tenant-scoped) opzoeken; onbekende id's per tenant rate-limiten. | ⏳ |
| R5 | Laag | Niet-geblurde productfoto's krijgen `max-age=1 jaar, immutable`; later blurren werkt niet voor caches (`src/app/uploads/[...path]/route.ts`). | Kortere max-age of sleutel roteren bij blur-wijziging. | ⏳ |
| R6 | Laag | SUPERADMIN-tenantswitcher toont zonder cookie `tenants[0]` (kan SUSPENDED zijn) terwijl `requireStaffContext` de eerste ACTIVE tenant gebruikt (`src/lib/admin-tenant.ts` vs `src/server/context.ts`). | Dezelfde regel in beide. | ⏳ |
| R7 | Laag | Admin-upload en `/api/collect` lezen de body zonder harde limiet als `Content-Length` ontbreekt (staff-only resp. kleine JSON). | `proxy-body-size` op ingress (k8s) + 411 zoals bij `/sell/upload`. | ⏳ |
| R8 | Laag | HSTS alleen in de ingress-config, niet in de app. | Documenteren als ingress-eis of in proxy zetten bij https in productie. | ℹ️ |
| R9 | Laag/Info | Registratie zegt "e-mail al in gebruik" (ook voor staff-adressen) → account-enumeratie, beperkt door Turnstile + 10/uur/IP. | Neutrale melding + mail naar bestaand account, of risico accepteren. | ⏳ |
| R10 | Info | Sessiecookie heet `qm_session`; `__Host-`-prefix zou planten vanaf een subdomein blokkeren. Vlaggen zijn goed (httpOnly, SameSite=Lax, Secure in productie, host-only). | Hernoemen bij een volgende sessie-migratie (logt iedereen uit). | ⏳ |
| R11 | Info | Newsletter-preview laadt externe afbeeldingen (IP-lek van admin); scripts zijn al geblokkeerd (sandbox-iframe). | Optioneel `referrerpolicy="no-referrer"`. | ℹ️ |
| R12 | Info | Mollie `redirectUrl` wordt uit de request-Host gebouwd; niet uitbuitbaar (Host is via exacte `TenantDomain`-lookup al een domein van deze tenant). | Hardening: `tenantBaseUrl(tid)` gebruiken. | ⏳ |
| R13 | Info | Bij `TRUSTED_PROXY_HOPS=0` valt elke per-IP-limiet terug op één gedeelde "unknown"-bucket (bv. `cart.add:<tenant>:unknown`). | Productie **moet** `TRUSTED_PROXY_HOPS` zetten (k8s: 1). De app logt een waarschuwing als er in productie XFF binnenkomt bij 0. | ℹ️ |
| R14 | Info | Nog niet-atomaire limieten (`isLimited` → later `hit`) bij leads-indienen en saved-search-aanmaak (hit pas na validatie/captcha). | Laag risico (Turnstile); omzetten naar `take()` waar het gedrag dat toelaat. | ⏳ |

## Opgelost in deze ronde

| Ernst | Bevinding | Oplossing |
|---|---|---|
| Middel | Een OWNER kon in de analytics-instellingen een willekeurig Matomo `siteId` kiezen; de API-call gebruikt het **platform**-token → statistieken van andere shops lezen. | `updateSettings`: alleen SUPERADMIN mag `analytics.matomoSiteId`/`matomoUrl` wijzigen (`src/server/settings/index.ts`). |
| Laag | Storefront kon geframed worden (clickjacking op checkout/account). | `X-Frame-Options: SAMEORIGIN` op alle niet-admin-responses (admin blijft `DENY`) — minimale wijziging in `src/proxy.ts`. |
| Laag | 2FA uitzetten liet sessies op andere apparaten actief. | `disableTotp` beëindigt alle andere sessies. |
| Laag | Publieke `/sell/upload` bufferde chunked bodies zonder `Content-Length` volledig in geheugen. | Zonder geldige `Content-Length` → 411. |
| Laag | Lead-foto-limiet niet atomair. | `take()` (na de "lead al ingediend"-check). |
| Laag | Alerts gaven gasten `"limit"` terug → bevestigt dat een adres al 5 alerts heeft. | Gasten krijgen het neutrale `"pending"`. |
| Info | Foutmeldingen van `sharp` gingen naar de client. | Generieke melding, details in de serverlog. |
| Info | Menu-items met type `url` werden bij lezen niet opnieuw gecontroleerd (ETL-rijen). | `sanitizeUrl` in `getPublicMenu`. |

## R1 — koppelen pas na bewezen e-mailadres (`src/server/customer-auth/link.ts`)

Het eigenaarsbesluit blijft: een geregistreerde klant krijgt zijn eerdere gastorders — maar pas als het adres bewezen is.
- **Bewijs** = klikken op de verificatielink (`verifyCustomerEmail`), een geslaagde wachtwoord-reset (de link ging naar die mailbox; zet ook `emailVerifiedAt`), of een account dat de ETL al geverifieerd/gekoppeld aanlevert.
- **Tot dan** heeft het account een eigen `Customer` met placeholder-adres `pending-<userId>@unverified.invalid` (`Customer.email` is uniek per tenant en het echte adres kan al bij een gast-`Customer` horen). Gevolgen: gast-checkouts met dat adres blijven bij de gast-`Customer`; verlanglijst-/alertmails gaan niet uit (`.invalid` wordt door de mailjob overgeslagen); orders die de klant ingelogd plaatst, horen gewoon bij het account.
- **Bij bewijs** (`claimVerifiedEmail`): de gast-`Customer` van het adres wordt samengevoegd (orders, adressen, verlanglijst, nieuwsbrief, winkelwagens, alerts, biedingen), ongekoppelde orders met dat adres worden gekoppeld, de `Customer` krijgt het echte adres. Geaudit als `customer.email_claimed`. Bij inloggen van een geverifieerd account worden nieuwe gastorders met het adres ook gekoppeld (vervangt de oude "op e-mail tonen"-fallback).
- **E-mailwijziging**: alleen de login wijzigt; de `Customer` gaat terug naar de placeholder; samenvoegen pas na verificatie van het nieuwe adres.
- **Orderoverzicht** (`listCustomerOrders`): alleen orders met `customerId` van het account, nooit meer op e-mail.
- `.invalid`-adressen worden geweigerd bij registratie, e-mailwijziging en gast-checkout.
- Staff-/admin-aangemaakte klanten en geverifieerde ETL-accounts blijven werken: hun gekoppelde `Customer` wordt gewoon gevonden.
- **ETL** (`scripts/etl/steps/users.ts`, niet gewijzigd): zet `emailVerifiedAt` = legacy `email_verified_at` (anders `null`) en koppelt de `Customer` met dat adres direct aan de gebruiker; `steps/orders.ts` koppelt gastorders (zonder `customer_id`) op e-mail aan die `Customer`. Voor legacy-accounts **zonder** `email_verified_at` is dat hetzelfde patroon als R1, maar op historische data uit Concept500 (geen nieuw aanvalspad). Aanbeveling aan de ETL: voor zulke accounts gastorders op e-mail met `customerId = null` laten — `claimVerifiedEmail` koppelt ze dan bij verificatie of reset.

## Uitgevoerde backlogpunten (#4–#11) — aanpak en grenzen

### Proxy-vertrouwen (#4, #10) — `src/server/request-meta.ts`
- Next 16 geeft geen socket-adres meer (geen `request.ip`); de Node-server van Next doet `x-forwarded-for ??= socket.remoteAddress`, dus een door de client meegestuurde XFF komt ongewijzigd binnen en is niet van het socket-adres te onderscheiden.
- Daarom `TRUSTED_PROXY_HOPS` (env, geheel getal, standaard 0): 0 = XFF en X-Real-IP volledig negeren (IP onbekend → `null`); N = de N-de waarde van rechts in XFF (alles links daarvan kan vervalst zijn). Achter ingress-nginx: 1; achter cloud-LB + ingress: 2. Ongeldige IP-waarden → `null`.
- Eén centrale plek: `clientIpFromHeaders`, `requestClientIp`, `requestHost`, `isSameOrigin`. Alle losse XFF-lezingen (sessie-meta, audit, login, klant-acties, analytics, uploads, certificaat-verificatie) gebruiken deze nu.
- **Host:** tenant-resolutie en Origin-checks gebruiken alleen `Host`. `X-Forwarded-Host` wordt bewust genegeerd: Next vult die zelf uit Host als hij ontbreekt, maar laat een door de client gezette waarde staan — vertrouwen zou een client een tenant laten kiezen / een Origin-check laten passeren. ingress-nginx stuurt de originele Host door. De twee upload-routes lazen eerder `x-forwarded-host`; nu `isSameOrigin`.

### Backoff i.p.v. lock-out (#5) en atomaire limieten (#6) — `src/server/auth/rate-limit.ts`
- `attempt(key, policy)`: eerste `free` mislukkingen gratis, daarna wachttijd `base · 2^(n−free)` sinds de vorige poging, gemaximeerd. Login per account: 5 gratis, 1 s → max 5 min; per IP: 20 gratis, max 15 min; her-authenticatie per gebruiker: 5 gratis, max 5 min. Venster 1 uur, succes wist de account-teller. Geen harde lock-out meer: de echte eigenaar kan na hooguit 5 minuten weer inloggen; een aanvaller krijgt ±12 pogingen/uur per account.
- Geen enumeratie: de account-sleutel hangt alleen af van het ingevoerde e-mailadres, dus onbekende adressen gedragen zich identiek (getest). Een geweigerde poging telt niet mee; een geslaagde login telt niet mee voor het IP.
- Atomair: tellen + beslissen + registreren in één transactie met `pg_advisory_xact_lock(hashtextextended(key))`. Pogingen worden **vóór** de wachtwoordcheck geregistreerd. Getest met 25 parallelle requests (exact 5 door) en 10 parallelle foute logins (exact 5 gecontroleerd). Ook TOTP-pogingen, TOTP-replay ("eerste gebruik wint"), wachtwoord-reset, registratie en de eenvoudige shop-limieten (winkelwagen, checkout, offers, nieuwsbrief, verificatie) gebruiken nu `take`/`consume`.
- Kanttekening: wachten op de lock houdt een DB-verbinding vast; per sleutel kort, maar bij een gerichte flood op één sleutel merkbaar in de pool.

### Herstelcodes (#7) — `src/server/auth/tokens.ts`
- 18 tekens uit 31 symbolen (geen look-alikes) ≈ **89 bits**, weergave `xxxxxx-xxxxxx-xxxxxx`; rejection sampling (bytes ≥ 248 weggooien) → geen modulo-bias.
- Opslag `h1:` + HMAC-SHA256 met een sleutel afgeleid (HKDF, `quartermaster:recovery-codes`) van het bestaande `APP_ENCRYPTION_KEY` — geen nieuwe env-variabele.
- Migratie: geen schemawijziging. Bestaande codes (10 tekens, SHA-256) blijven werken tot ze gebruikt zijn: bij invoer van 10 tekens wordt de oude hashvorm gezocht. Nieuwe codes krijgt de gebruiker bij opnieuw inschakelen van 2FA. Let op: roteren van `APP_ENCRYPTION_KEY` maakt alle nieuwe herstelcodes (en TOTP-secrets) ongeldig.

### Wachtwoord-reset (#8)
- De formulieren (admin + shop) doen nu voor elk adres hetzelfde: optionele per-IP-limiet (`passwordResetPerIp`, 20/uur) en één job-insert `auth.password-reset.request` (`src/server/auth/jobs.ts`). De worker zoekt het account op, maakt het token en zet de mail (`mail.send`) in de wachtrij. Response en timing zeggen dus niets over het bestaan van het account; de job-payload bevat geen token.
- Gevolg: zonder draaiende worker gaan er geen reset-mails uit (gold al voor alle mail).

### `?next=` na login (#9)
- `safeAdminRedirect` (alleen `/admin…`) en `safeShopRedirect` (alleen storefront-paden, nooit `/admin`/`/api`) zijn geverifieerd met een lijst vijandige invoer (`//`, `\`, schema's, control chars, tabs, dot-segments, lange invoer); `src/lib/admin-nav.test.ts` controleert dat het resultaat altijd op dezelfde origin blijft.

### Tenant-isolatie (#11) — `src/server/tenant-scope.ts`
- Laag 1 (bestaand): services filteren expliciet op `ctx.tenantId`.
- Laag 2 (nieuw): `tenantDb(tenantId)` — Prisma client-extension die op alle modellen met verplichte `tenantId` de `where` dwingt naar die tenant (ook `findUnique`/`update`/`delete` op id → vreemde id = niet gevonden), `tenantId` bij create invult en een andere tenant, een niet-letterlijk filter of het "verhuizen" van rijen weigert (`TenantScopeError`). Werkt ook binnen interactieve transacties.
- In gebruik in de order-queries en de customers-service; overige services kunnen stap voor stap overstappen (`db` → `tenantDb(ctx.tenantId)`).
- Tests: `tests/integration/tenant-isolation.int.test.ts` bewijst dat lezen/wijzigen/verwijderen over tenants heen faalt voor producten, orders, klanten, pagina's en redirects (service-niveau, met NOT_FOUND) en via `tenantDb`; een unittest houdt de modellenlijst gelijk aan `schema.prisma`.
- Grenzen: alleen top-level queries (geen nested writes, relation-filters of `include`s); raw SQL valt erbuiten; alleen code die `tenantDb` gebruikt is beschermd; `User` en `AuditLog` (nullable `tenantId`) vallen erbuiten. Relaties naar een rij van een andere tenant (bv. `OrderLine.productId`) worden door het schema niet voorkomen.

## Legacy-wachtwoorden (Concept500 / Laravel bcrypt)

- `src/server/auth/legacy-bcrypt.ts`: eigen bcrypt-**verificatie** (EksBlowfish volgens OpenBSD/OpenWall). P-array en S-boxes worden bij eerste gebruik uit π berekend (Machin, BigInt) i.p.v. een tabel van 1042 woorden; begin- en eindwoorden zijn getest. 72-byte-truncatie, bcrypt-base64, `$2y$` = `$2b$`; `$2a$` met de crypt_blowfish-tegenmaatregel (identiek aan PHP); `$2x$`/`$2$` geweigerd; cost buiten 4..15 en misvormde hashes geweigerd; constant-time vergelijking.
- Opslag door de ETL: `passwordHash = "bcrypt$" + <60 tekens>`. `verifyPassword` herkent het prefix; `needsRehash` is altijd waar. Na een geslaagde controle wordt direct naar scrypt herhasht (voorwaardelijk op de oude hash, dus nooit over een gelijktijdige reset heen) en `auth.password_rehashed` geaudit — bij admin-login, shop-login (loopt via dezelfde `login`) en alle her-authenticaties (`verifyCurrentPassword`: 2FA uitzetten, wachtwoord/e-mail wijzigen, account verwijderen, staff-profiel). Reset zet sowieso een nieuwe scrypt-hash.
- Testvectoren: OpenWall crypt_blowfish `wrapper.c`, uitvoer van PHP 8.4.16 `crypt()` en de Laravel-factoryhash; alles bevestigd met PHP.
- Snelheid (Node 24, Apple M-serie): cost 10 ≈ **60–80 ms** (π-tabellen eenmalig ≈ 50 ms per proces). De kostenlus geeft elke 16 rondes de event loop vrij, dus één verificatie blokkeert andere requests niet.
- Timing: een bcrypt-account (≈ 70 ms) en een onbekend account (scrypt dummy, vergelijkbare orde) zijn niet exact even snel; het verschil verdwijnt zodra de gebruiker eenmaal heeft ingelogd. Geaccepteerd.

## Gecontroleerd en in orde (selectie)

- Alle admin-server-actions roepen `requireStaffContext`/`requirePlatformContext`/`requireAccount` aan; platform-services controleren SUPERADMIN opnieuw; OWNER kan alleen eigen tenant.
- Server Actions: Next-Origin-check intact (geen `allowedOrigins`); POST-route handlers controleren Origin of hebben een bearer/HMAC.
- Sessies: nieuw token bij login en na 2FA (geen fixation), logout verwijdert de rij, uitgeschakelde gebruikers/verlopen sessies worden geweigerd, pending-TOTP-sessies werken nergens anders.
- Mollie-webhook: status altijd opnieuw opgehaald met de sleutel van de tenant, tenant-scoped lookup met `FOR UPDATE`, idempotent.
- Uploads: geen path traversal, alleen rasterformaten (opnieuw gecodeerd door sharp), `nosniff` + `CSP: default-src 'none'; sandbox`; lead-foto's privé.
- Cron: faalt dicht zonder (of met te kort) secret, timing-safe vergelijking.
- SSRF: geen uitgaande fetch naar door eigenaar/bezoeker bepaalde URL's (Matomo vast op `MATOMO_URL`, https, geen redirects).
- XSS: Markdown als React-elementen, URL's via `sanitizeUrl`, JSON-LD ge-escaped, geen eigen HTML/CSS/JS van eigenaren, nieuwsbrief-preview in sandbox-iframe.
- Mail-links (reset, uitnodiging) komen uit `TenantDomain`/`APP_URL`, nooit uit de request-Host (geen host-header poisoning).
