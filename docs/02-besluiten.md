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
