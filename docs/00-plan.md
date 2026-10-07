# Quartermaster — Migratieplan (Concept500 → Next.js + Prisma)

> Status: **besluiten genomen** — zie `02-besluiten.md` (gaat voor bij verschil).
> Bronnen: `analysis/01-admin-inventory.md`, `analysis/02-data-model.md`, `analysis/03-shop-and-integrations.md`, `analysis/schema.draft.prisma`.
> Design: `design/quartermaster-design.html`.
> Repo: https://github.com/woutvdpol/Quartermaster.git

---

## 1. Samenvatting

Concept500 is een Laravel 12 + Backpack + Livewire webshop (MariaDB, Cloudflare Images, Mollie/PayPal) die als white-label *multi-instance* SaaS wordt uitgerold. Quartermaster herbouwt dit in **Next.js (App Router) + Prisma**, met **admin als eerste prioriteit**, daarna de shop.

Het is geen 1-op-1 port. De analyse toont structurele problemen die we in de nieuwe opzet oplossen i.p.v. meenemen:

| # | Probleem in Concept500 | Oplossing in Quartermaster |
|---|---|---|
| 1 | Order-afronding (voorraad, mails) gebeurt alleen op de bedankpagina → betaald + tab dicht = geen mail, item blijft te koop | Idempotente **webhook-handler** + job-queue; statuspagina alleen fallback |
| 2 | Geen voorraadreservering bij order → unieke items dubbel verkocht | **Reservering** gekoppeld aan mandje/order met TTL, atomaire stock-update in transactie |
| 3 | Statussen als losse strings, geen fulfilment-status, geen factuur | Expliciete `PaymentStatus` + `FulfillmentStatus` enums, statushistorie, factuur-PDF |
| 4 | Owner kan via URL bij Users/Roles (privilege escalation); mutaties via GET | Server-side RBAC per action, alleen POST/server actions, audit-log |
| 5 | Settings: ~60 EAV-rijen, type geraden uit key-naam | Getypeerde settings (Zod-schema per groep), tab-UI |
| 6 | Twee CMS'en naast elkaar | Eén block-CMS |
| 7 | Geen echte klant-entiteit | `Customer` (guest + account) gekoppeld aan orders |
| 8 | Prijsbugs (`order_details.price` vermoedelijk euro's i.p.v. centen, geen titel-snapshot) | Order-regels met snapshot (titel, prijs, foto) in minor units + currency |
| 9 | Handmatige regio-keuze voor verzendkosten (manipuleerbaar) | Verzendzones op ISO-land, afgeleid van adres |

## 2. Doelarchitectuur

| Laag | Keuze (voorstel) | Waarom |
|---|---|---|
| Framework | **Next.js 16** App Router, TypeScript strict, RSC + Server Actions | Gevraagd; één codebase voor admin + shop |
| ORM | **Prisma 7** (`prisma.config.ts`) | Gevraagd |
| Database | **PostgreSQL 17** | Full-text (tsvector + pg_trgm), JSONB voor blocks/settings, betere enum/transactie-semantiek |
| Multi-tenant | `Tenant` + `tenantId` op alle shopdata vanaf dag 1, host-resolutie in middleware, Prisma-extension | Eerst eigen shop, daarna meerdere |
| Auth | **Eigen implementatie** op Node `crypto` (scrypt, DB-sessies, TOTP) | Geen auth-dependency; zie `02-besluiten.md` |
| UI | **Tailwind v4 + shadcn/ui** (Radix), TanStack Table, React Hook Form + Zod | Snel bouwen van dichte admin-schermen; eigen tokens |
| Media | **Lokale opslag** via `StorageDriver` (`LocalDriver`), varianten met `sharp` | Geen Cloudflare; later S3/R2-driver mogelijk |
| Betalingen | **Alleen Mollie** (`@mollie/api-client`) | Webhook-gedreven; PayPal via Mollie |
| Mail | **React Email** + SMTP (Nodemailer) of Resend | Templates als componenten |
| PDF | `@react-pdf/renderer` | Pakbon + factuur (WIP) |
| Jobs/cron | **pg-boss** (queue in Postgres) + cron route handlers met `CRON_SECRET` | Geen Redis nodig |
| Zoeken | Postgres FTS; Meilisearch optioneel bij facetten (fase 5) | Start simpel |
| Analytics | Matomo-koppeling óf eigen lichte analytics (pageviews-tabel) | Beslissen in fase 2 |
| Bot-check | Cloudflare Turnstile | Bestaand |
| Tests | Vitest (unit), Playwright (e2e: checkout + admin-flows) | |
| Observability | Sentry + gestructureerde logs (pino) | |
| Hosting | Lokaal Docker Compose; later Kubernetes | Stateless, standalone output, health-checks |
| CI | GitHub Actions: lint, typecheck, test, build, `prisma migrate deploy` | Repo naar GitHub |

### Projectstructuur

```
quartermaster/
├─ app/
│  ├─ (shop)/            # publieke shop — fase 3
│  ├─ admin/             # beheer — fase 1-2
│  │  ├─ (auth)/login
│  │  ├─ dashboard/ products/ orders/ customers/ categories/
│  │  ├─ shipping/ payments/ content/ newsletter/ settings/ users/ audit/
│  └─ api/               # webhooks (mollie, paypal), cron, cf-upload
├─ src/
│  ├─ server/            # domeinlogica: services per module (orders, stock, pricing…)
│  ├─ db/                # prisma client, extensions
│  ├─ components/ui/     # shadcn
│  ├─ components/admin/  # DataTable, MediaGallery, StatusPill, CommandMenu…
│  ├─ emails/ pdf/
│  └─ lib/               # money (dinero.js / eigen Money-helper), auth, rbac, settings
├─ prisma/schema.prisma
├─ scripts/etl/          # migratie Concept500 → Quartermaster
└─ docs/
```

Regel: **alle mutaties via `src/server/*` services** (één plek voor RBAC-check, validatie, audit-log, transacties). Server actions en webhooks zijn dunne lagen erboven.

## 3. Datamodel (kern, nieuw)

Uitgewerkt in `analysis/02-data-model.md`. Kernpunten:

- `Product`: behoudt bestaand **ID/StockCode** (URL's + oude links), `sku` uniek, `slug` uniek, **opgeslagen** `status` (`DRAFT · ACTIVE · RESERVED · SOLD · ARCHIVED · STOLEN`), `publishedAt` (vervangt `updated_at`-truc voor "bump to top"), SEO-velden, `images` als relatie (`ProductImage{cfImageId, sort, alt}`).
- `StockMovement` ledger (inkoop, verkoop, correctie, reservering, release).
- `Reservation{cartId|orderId, productId, expiresAt}`.
- `Order` + `OrderLine` (snapshot) + `OrderAddress` + `Payment` (meerdere pogingen) + `OrderEvent` (statushistorie).
- `Customer` (guest of gekoppeld aan `User`), `User` met `role` (`OWNER · STAFF · SUPERADMIN`) — spatie-tabellen vervallen.
- `ShippingZone{countries[]}` + `ShippingRate{zone, maxWeight, price}`.
- `Setting` als getypeerde JSONB per groep; `AuditLog`; `Redirect`; `ExchangeRate` (historie, `decimal(18,8)`).
- Geld: `Int` minor units + `currency` kolom overal.

## 4. Data-migratie

Aanbeveling: **schoon schema + idempotent TypeScript ETL** (`scripts/etl`), met het gemapte draft-schema als read-only Prisma-client op (een kopie van) de oude MariaDB.

- Behouden: product-ID's (leidend), order-ID's/UUID's. Foto's: downloaden uit Cloudflare naar lokale opslag. Wachtwoorden: bcrypt-verify + herhash of reset-mail (beslissen bij ETL).
- **Timing:** historische data nu niet; ETL komt later (besluit 23). Ontwikkeling gebeurt op seed-data + testdump.
- Opschonen tijdens ETL: dubbel-ge-encodeerde photos-JSON, `order_details.price` normaliseren (eerst verifiëren op dump), lege UUID's genereren, status afleiden en opslaan, `utf8mb4`/emoji's.
- Redirects: oude URL-patronen → nieuwe (301), incl. legacy `/shop.php?code=`.
- Draaien: meerdere dry-runs op productiedump → validatierapport (aantallen, omzet-totalen gelijk) → cutover.

## 5. Roadmap (admin eerst)

Admin wordt eerst gebouwd en gedemonstreerd op een **ETL-kopie** van de echte data. Live gaan gebeurt in één cutover samen met de shop — admin los live naast de oude Laravel-shop vereist twee-weg-sync en raad ik af.

| Fase | Inhoud | Opleverbaar |
|---|---|---|
| **0. Fundament** | Repo, CI, Next+Prisma+Postgres, Docker, eigen auth (scrypt, sessies, TOTP), RBAC, design tokens + admin-shell (sidebar, ⌘K), audit-log, ETL-skelet | Inlogbare admin met tenant-switch op seed-data |
| **1. Admin kern** | **Producten** (lijst met opgeslagen views, bulk-acties, editor met foto-drag&drop naar CF, status, SEO), **Categorieën/Tags**, **Orders** (lijst + detail, statusflow, pakbon, factuur, notities, terugbetaling), **Klanten**, **Voorraadoverzicht** | Dagelijks werk kan in Quartermaster |
| **2. Admin rest** | Dashboard (KPI's, omzet-grafiek, Matomo), Settings (getypeerd, tabs), Verzendzones, Betaalmethoden, **Block-CMS** + menu's, Nieuwsbrief, Inkoop/herkomst, Import/Export (CSV), Gebruikers & rollen | Admin feature-compleet |
| **3. Shop** | Catalogus + filters + zoeken, productpagina (deep zoom), wishlist, mandje met echte reservering, checkout (1 pagina, guest), Mollie-webhooks, mails, account, CMS-pagina's, SEO (sitemap, JSON-LD, redirects), leeftijd-gate server-side | Shop feature-pariteit + fixes |
| **4. Migratie & cutover** | ETL dry-runs, validatierapport, redirect-test, Playwright e2e op staging, DNS-switch, oude omgeving read-only | Live |
| **5. Vernieuwingen** | Zie §6, op volgorde van keuze | Iteratief |

## 6. Vernieuwingen (voorstel, uit analyse)

**Admin**
- ⌘K command-menu (zoek product op StockCode, order op nummer, "nieuw product").
- Opgeslagen views + bulk-edit (prijs, categorie, status) in producttabel.
- Snelle intake: foto's droppen → product-concept aanmaken, drag-sort, alt-tekst.
- Order-bord (Nieuw → Betaald → Ingepakt → Verzonden) met track & trace + "verzonden"-mail.
- Factuur-PDF incl. **margeregeling**; automatische nummering.
- Audit-log ("wie zette order #8123 op betaald?").
- Marge-rapport (inkoopprijs ↔ verkoop) uit bestaande inkoopadministratie.

**Shop** (waarde/effort uit `03` §9)
1. Facet-taxonomie: periode · land · krijgsmachtdeel · eenheid · type (H / M–L)
2. Saved searches + "notify me" bij nieuwe aanwinsten (H / M)
3. Echte reservering met countdown + optionele layaway/aanbetaling (H / M–L)
4. Herkomst + certificaat van echtheid (PDF + QR-verificatie) (H / M)
5. Deep zoom voor markeringen/stempels (H / S–M)
6. Compliance per land (symbolen-weergave §86a, verzendblokkade per categorie × land, deactivatiecertificaat) (H / M)
7. Bieden / make-an-offer (M–H / M)
8. Referentie-archief verkochte items (SEO) (M–H / S)
9. Kortingscodes, abandoned-cart-mail, multi-currency checkout (M)

## 7. Design-richting

Zie `design/quartermaster-design.html`. Admin: compact, data-dicht "depot/inventaris"-gevoel — olijf/veldgrijs neutrals, messing accent, condensed labels, mono voor StockCodes en bedragen, light + dark. Shop: bouwt verder op bestaande redesign-intentie (`redesign.md`: messing/leer palet) maar via tokens zodat white-label (indien gewenst) blijft werken.

## 8. Risico's

| Risico | Mitigatie |
|---|---|
| Datakwaliteit oude DB (prijzen, JSON, encoding) | ETL met validatierapport, meerdere dry-runs |
| SEO-verlies bij URL-wijziging | Product-ID's behouden, redirect-tabel, sitemap direct na cutover indienen |
| Juridisch (militaria-symbolen, wapens, leeftijd) | Compliance-flags per categorie in datamodel vanaf fase 0 |
| Scope creep door vernieuwingen | Fase 5 apart, MVP-lijst expliciet kiezen |
| Multi-tenant later toevoegen is duur | Beslissen vóór fase 0 (vraag 1) |

## 9. Open vragen

Zie overzicht in chat / `docs/01-vragen.md`.
