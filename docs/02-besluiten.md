# Besluiten — Quartermaster

Antwoorden van de eigenaar op `01-vragen.md` (07-10-2026). Deze gaan voor op voorstellen in `00-plan.md` waar ze verschillen.

## Strategie
| # | Onderwerp | Besluit | Gevolg |
|---|---|---|---|
| 1 | Shop of platform | Eerst eigen shop, daarna **multi-tenant** platform (meerdere shops) | `Tenant`-model + `tenantId` op alle shopdata **vanaf dag 1**; tenant-resolutie via host in middleware; Prisma-extension die `tenantId` afdwingt |
| 2 | Bestaande installaties | "Een aantal" later migreren | ETL per tenant, niet nu |
| 3 | Database | **PostgreSQL** | |
| 4 | Hosting | Lokaal **Docker** (compose); later **Kubernetes** | Stateless app, `output: "standalone"`, health-endpoints, config via env, uploads op volume (later object storage) |
| 5 | Talen | Engels; later meertalig | Teksten via eenvoudige dictionary-laag, geen hardcoded strings in componenten; datamodel nog niet vertaalbaar |

## Admin
| # | Onderwerp | Besluit |
|---|---|---|
| 6 | Rollen | `SUPERADMIN` = Quartermaster-beheer (alle tenants, platform-settings). `OWNER` = shop-eigenaar (eigen tenant). Klanten = `CUSTOMER` |
| 7 | 2FA | Ondersteunen (TOTP), niet verplicht |
| 8 | Verzendstatus / track & trace | **WIP** — model voorbereiden, UI met WIP-label |
| 9 | Facturen | **WIP** |
| 10 | Orders verwijderen | Nooit; alleen **archiveren** |
| 11 | Productstatussen | Eén status per product; betekenis later bepalen |
| 12 | Inkoopadministratie + marge | Ja |
| 13 | Product-import / exports | Nee |
| 14 | Nieuwsbrief | Zelf blijven versturen (eigen module) |
| 15 | Analytics | Matomo, of een goed alternatief; eventueel zelf bouwen |

## Shop
| # | Onderwerp | Besluit |
|---|---|---|
| 16 | Betalen | **Alleen Mollie** (iDEAL, Bancontact, kaart, PayPal via Mollie) |
| 17 | Valuta | Alleen weergave; afrekenen in shopvaluta |
| 18 | Reservering | **15 minuten**, geen aanbetaling/layaway |
| 19 | Compliance/blur | Zoals nu (blur + login voor gevoelige items) |
| 20 | Leeftijd / guest checkout | Zoals nu |
| 21 | Verzending | **Zones per land** (ISO), gewichtsstaffels per zone — moet echt beter |
| 22 | URL's | Mogen veranderen (geen redirect-eis) |

## Data
| # | Onderwerp | Besluit |
|---|---|---|
| 23 | Historische data | Nu niet; later wel → ETL blijft op roadmap, niet blokkerend |
| 24 | Dump | Testshop-dump aangeleverd (`main.sql`) — lokaal in `.local/`, **nooit committen** |
| 25 | `old_database` | Waarschijnlijk niets meer |
| 26 | Leidende ID | `id` (StockCode) |

## Scope & proces
| # | Onderwerp | Besluit |
|---|---|---|
| 27 | Vernieuwingen | **Alles** (gefaseerd) |
| 28 | Design | Redelijk; varianten B en C laten maken |
| 29 | Livegang | Admin + shop samen |
| 30 | Git | Init + push naar GitHub, README opbouwen |

## Extra
- **Afbeeldingen lokaal** opslaan, geen Cloudflare Images. → `StorageDriver`-interface met `LocalDriver` (`/uploads/{tenant}/products/{id}/…`, varianten via `sharp`); later S3/R2-driver zonder codewijziging elders.
- **Eigen auth, zonder auth-package.** → zie hieronder.

## Eigen authenticatie (voorstel)

Kan, en is voor deze scope goed te doen. Alles met Node's ingebouwde `crypto`:

| Onderdeel | Aanpak |
|---|---|
| Wachtwoord-hash | `crypto.scrypt` (N=2^15, r=8, p=1, 16-byte salt), opslag `scrypt$N$r$p$salt$hash`; vergelijken met `timingSafeEqual` |
| Sessies | Willekeurig token (32 bytes) in `httpOnly; Secure; SameSite=Lax` cookie; in DB alleen **SHA-256 van het token**; sliding expiry (30 d klant, 12 u admin); intrekken = rij verwijderen |
| CSRF | Server Actions hebben Origin-check ingebouwd; route handlers (POST) checken `Origin`/`Host` zelf |
| 2FA | TOTP (RFC 6238) met HMAC-SHA1 uit `crypto` + base32; herstelcodes gehasht opgeslagen |
| Wachtwoord vergeten / e-mail bevestigen | Eenmalige tokens (gehasht, 30 min geldig) |
| Rate limiting | Tabel met pogingen per IP + account; lock-out met backoff |
| Autorisatie | `requireUser()`, `requireRole("OWNER")`, `requireTenantAccess(tenantId)` in `src/server/auth/*`; elke service roept dit aan |
| Admin vs klant | Zelfde `User`-tabel, rol bepaalt toegang; admin-sessie korter + optioneel 2FA |

Kanttekeningen:
- Security-verantwoordelijkheid ligt dan bij ons → tests op elk onderdeel + een review vóór livegang.
- **Oude Laravel-wachtwoorden** zijn bcrypt (`$2y$`). Node heeft geen ingebouwde bcrypt. Bij latere migratie (punt 23): óf één kleine dependency alleen om oude hashes te verifiëren en direct te herhashen naar scrypt, óf iedereen een reset-mail. Beslissen bij de ETL.

## Design (07-10-2026)
- **Ontwerp A ("Depot")** is de standaard voor de admin.
- **B ("Field Ledger") en C ("Naval Quiet") blijven altijd beschikbaar.** De admin-UI wordt volledig via design-tokens gebouwd (`data-admin-theme="depot|ledger|naval"`), zodat B en C als thema toegevoegd/gekozen kunnen worden zonder componenten te herschrijven. C wordt als moderne kandidaat gezien.
- Mockups: `docs/design/quartermaster-design{,-b,-c}.html`.

## Fundament — akkoord eigenaar (07-10-2026)
- Elk product is een uniek item; max. één actieve reservering per product.
- Onbetaalde overschrijvingen (legacy `manual`) = `PENDING`, tellen niet als omzet.
- `PaymentProvider.MANUAL` blijft naast Mollie (admin "markeer als betaald", legacy).
- Verlanglijst alleen voor ingelogde klanten.
- Tijdzone alleen op `Tenant.timezone` (niet in settings).
- Reserveringstijd instelbaar door eigenaar, 5–60 min (standaard 15).
- Leeftijdsverificatie: modi off / popup / checkout.
- Standaarden: gast-checkout aan, gevoelige items blurren voor gasten, eigen analytics.

## Fase 1–2 afronding — akkoord eigenaar
- Anonimiseren wist het klantprofiel, **niet** naam/adres op orders (fiscale bewaarplicht 7 jaar).
- Oversell: boeken wat er is + waarschuwing op order; geen automatische refund (later).
- Refunds tellen niet mee in omzet/marge.
- Nieuwsbriefbevestiging via pagina met bevestigknop (POST) i.p.v. directe GET-link.
- Voorraad handmatig naar 0 → status blijft (geen automatische SOLD).

## Shop-design (07-10-2026)
- Vier richtingen getoond (canvas: https://claude.ai/artifact/XzjShLtkiEinkYQuJGf5F5, bronbestanden in `docs/design/shop-options/`): Archive, Field Kit, Gallery, Vault.
- **Gekozen: optie 3 "Gallery"** (wit, modern-minimaal, grote foto's, pill-knoppen) **met de itemnummers van optie 1** ("No. 50212" in mono, accentkleur).
- **Archive, Field Kit en Vault blijven bewaard voor een latere themabuilder.** Daarom: componenten gebruiken alleen tokens (`--shop-*`); een thema-preset (`appearance.theme`, nu alleen `gallery`) overschrijft tokens via `.shop-root[data-shop-theme=…]`. Lettertypes voor de andere presets staan al in de allowlist.
- Itemnummers standaard zichtbaar (`catalog.showStockCode` = aan).

## Fase 4 — akkoord eigenaar (07-10-2026)
- **Oude wachtwoorden:** eigen bcrypt-verificatie (geen package). ETL zet legacy-hashes als `bcrypt$…` in `passwordHash`; bij eerste geslaagde login wordt herhasht naar scrypt.
- **Hosting:** generieke Kubernetes-manifests (Kustomize, ingress-nginx, cert-manager); provider later.
- **Foto's uit Cloudflare:** nu niet downloaden. ETL krijgt een downloader-interface met `--skip-images` en een nep-downloader in tests; echte download pas bij de echte migratie.

## ETL-details — akkoord eigenaar (08-10-2026)
- Legacy `manual`-orders worden **altijd** onbetaald (PENDING) geïmporteerd, ook met `order_paid_on`; omzet sluit exact aan op legacy `paid`.
- De legacy `admin`-accounts worden OWNER van de tenant.
- Verzendregio "Freeyo" was testdata; geen handmatige landtoewijzing nodig.
- Toeslag per betaalmethode (legacy PayPal 5%) wordt in de admin instelbaar en door de ETL overgenomen.
- Hosting/provider nog onbekend; manifests blijven generiek.

## Innovaties ronde 1 — akkoord eigenaar (08-10-2026)
Volgorde: **themabuilder + startwizard** → **AI-plaatsingsassistent + slim zoeken** → doorlopend: **hele app sneller** (meten vóór/na).
- **Aanmelden:** handelaren melden zich zelf aan op het platform; SUPERADMIN keurt goed; daarna start de wizard.
  - *Binnenkort open* (uitwerking 08-10-2026): zolang de wizard niet is afgerond (`setupState` ≠ null, `setupCompletedAt` = null) zien bezoekers en klanten alleen een pagina "Opening soon" in de huisstijl van de shop (naam/logo, contactmail, nieuwsbriefaanmelding als die aan staat). Status **200 + noindex** (geen 503: een layout kan geen statuscode zetten en de proxy doet geen DB-lookups); robots.txt verbiedt alles, sitemap is leeg; winkelwagen, checkout, account, biedingen, alerts en "verkoop je collectie" weigeren. Ingelogde OWNERs van die shop zien de echte shop met een balk "Not live yet" (samengevoegd met de theme-preview-balk). Bestaande shops (`setupState` null) merken niets. Code: `src/server/storefront/launch.ts`.
- **Themabuilder:** preset (Gallery/Archive/Field Kit/Vault) + afstemmen (kleuren, lettertypes, hoekafronding, knopvorm, dichtheid, logo). Concept → live preview → publiceren.
- **Imports in de wizard:** WooCommerce-CSV, Shopify-CSV en Concept500 (onze ETL).
- **Sneller:** hele app (shop Core Web Vitals, admin-schermen, zoeken), met meetrapport vooraf en achteraf.

## Slim zoeken — akkoord eigenaar (08-10-2026)
- Ontwerp goedgekeurd (`docs/design/search/`): zoeken-terwijl-je-typt met "begrepen als"-chips, resultatenpagina met verwijderbare filters + "bijna-matches", zoeken op foto (mobiel), "Lijkt hierop" op productpagina.
- Hybride zoeken: Postgres full-text + pg_trgm (tikfouten) + facet-herkenning uit de zoekzin + semantische vectoren (pgvector).
- **Lokale AI-modellen (geen externe API) in een eigen Docker-container** (`embedder`-service: multilingual-e5-small voor tekst, SigLIP 2 base (Apache-2.0) voor foto's en foto-tekst; CLIP bleek alleen Engels te begrijpen). Intern bereikbaar met token; web/worker vallen terug op tekstzoeken als de embedder niet draait.

## AI-plaatsingsassistent — akkoord eigenaar (08-10-2026)
- Ontwerp goedgekeurd (`docs/design/ai-listing/`): concept uit foto's + notitie met herkomst per veld (gezien / notitie-historie / gok), "check before publishing", prijsvoorstel uit eigen verkopen, snelle flow op de telefoon, instellingen voor toon/regels. Publiceert nooit zelf.
- **Lokaal model, geen externe AI-dienst, geen API-sleutel en geen kosten per concept.** Draait in een eigen container (Ollama) naast de embedder; alleen modellen met een licentie die commercieel gebruik toestaat.
- Testshops `demo-onboarding` en `concept500-import` verwijderd uit de dev-database (backup in `.local/backups/`); script `npm run tenant:delete` voor de toekomst.
