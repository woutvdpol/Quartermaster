# Modules en pakketten

Shop-eigenaren kopen functionaliteit per module, als pakket of als compleet pakket ("click and buy").
Status: **fase 1 gebouwd** (branch `feature/modules-phase1`); fase 2–4 nog niet. De richting is akkoord (13-10-2026). Prijzen en de punten onder
"Aannames" zijn voorlopig: de eigenaar liet ze aan Claude over en kan ze later aanpassen.

## Uitgangssituatie (13-10-2026)

- Het platform rekent shops nu niets aan. Elke shop heeft een eigen Mollie-sleutel voor de eigen klanten.
- `platform.plan` (bronze/silver/gold) wordt opgeslagen maar nergens gelezen.
- `platform.productLimit` wordt niet afgedwongen.
- Wel afgedwongen: `photoLimit`, `storageQuotaGb`, `newsletterQuota`, `networkBlocked`.
- `newsletterEnabled` is de enige echte moduleschakelaar. Hij wordt gecontroleerd in admin-pagina's, services,
  de blokkiezer van het CMS en de `features`-map van de storefront (`storefront/context.ts`). Dat patroon
  breiden we uit.
- Concept500 verkoopt bronze/silver/gold: 100 / 500 / onbeperkt producten, 3 / 5 / 20 foto's per product, en de
  nieuwsbrief als losse module (`docs/analysis/01-admin-inventory.md`, `03-shop-and-integrations.md`).

## Indeling

### Basis (elke betalende shop)

Producten, categorieën, facetten, orders, checkout en Mollie, klanten en accounts, verzendzones en verzendbord,
facturen, CMS-pagina's, menu's, thema (presets), SEO en feeds, redirects, instellingen, gebruikers, auditlog,
compliance per land, setup-wizard, gewone tekstzoekfunctie en het dashboard.

### Modules

| Id | Module | Inhoud | Admin | Storefront / jobs |
|---|---|---|---|---|
| `auctions` | Veilingen | veilingen, live bieden, bieders, betaallink winnaar | `auctions` | `auctions/*`, SSE, jobs `auctions.*` |
| `fairs` | Beursmodus | verkopen op beurzen, QR-labels, offline sync | `fairs` | holds in de shop |
| `offers` | Bod doen | bod en tegenbod | `offers` | `offer/*`, cron `offers.expire` |
| `coupons` | Kortingscodes | codes en inwisselregels | `coupons` | winkelwagen, checkout |
| `newsletter` | Nieuwsbrief | inschrijvers, campagnes, verzendquotum | `newsletter` | `newsletter/*`, popup, blok |
| `alerts` | Alerts & push | zoekopdrachten, prijsdaling, weer beschikbaar, webpush | `alerts` | `alerts/*`, jobs `alerts.*`, `push.*` |
| `leads` | Inkoopaanvragen | "verkoop je collectie" | `leads` | `sell` |
| `smartSearch` | Slim zoeken | semantisch en op foto zoeken, "vergelijkbaar", dubbele foto's | — | `/api/search/*`, jobs `search.*` |
| `translations` | Vertalingen | NL/DE machinevertaling, woordenlijst | `translations` | `/nl`, `/de`, jobs `translations.*` |
| `insights` | Inzichten | voorraadwaarde, doorloop, "staat te lang", herprijzen | `insights` | — |
| `provenance` | Herkomst & certificaten | inkoop, margerapport, echtheidscertificaten, verificatiepagina | `sourcing` | `verify/*` |

Afhankelijkheden: webpush hoort bij `alerts`. De dubbele-fotocheck hoort bij `smartSearch`. Zonder
`smartSearch` valt de shop terug op de gewone tekstzoekfunctie (bestaat al).

Netwerkvermelding blijft gratis: het laat het netwerk groeien en het verdienmodel is nog niet bepaald.

### Pakketten

| Pakket | Was (Concept500) | Bevat | Producten | Foto's per product |
|---|---|---|---|---|
| **Start** | bronze | basis | 100 | 3 |
| **Pro** | silver | basis + `offers`, `coupons`, `newsletter`, `alerts`, `insights` | 500 | 5 |
| **Compleet** | gold | alles | onbeperkt | 20 |

Losse modules kunnen bovenop Start en Pro. Een module die al in het pakket zit, koop je niet nog een keer.

## Prijzen (voorlopig)

Alle bedragen per maand, exclusief btw. Jaarbetaling: 2 maanden gratis (10 × maandprijs).

| Pakket | Prijs | Losse modules opgeteld |
|---|---|---|
| Start | €29 | — |
| Pro | €59 | €69 |
| Compleet | €99 | €154 |

| Module | Prijs | | Module | Prijs |
|---|---|---|---|---|
| Veilingen | €25 | | Slim zoeken | €20 |
| Beursmodus | €10 | | Vertalingen | €15 |
| Bod doen | €5 | | Inzichten | €10 |
| Kortingscodes | €5 | | Herkomst & certificaten | €10 |
| Nieuwsbrief (incl. 5.000 mails) | €10 | | Inkoopaanvragen | €5 |
| Alerts & push | €10 | | | |

Extra's:

| Extra | Prijs |
|---|---|
| +500 producten | €10 |
| +5.000 nieuwsbriefmails | €5 |
| +10 GB opslag | €5 |

Slim zoeken en Vertalingen zijn duurder omdat ze rekenkracht van de embedder gebruiken.

### Nieuwsbriefcredits

Naast het maandquotum kan een shop credits hebben: losse pakketten mails die niet verlopen
(`TenantPlan.newsletterCredits`). Een campagne gebruikt eerst het maandquotum en betaalt alleen het deel
dat niet meer past uit de credits. Dat deel staat op de campagne (`creditsUsed`) en telt niet mee voor het
maandquotum. In fase 1 vult de superadmin credits met de hand aan. In fase 3 koopt de eigenaar ze zelf
op de nieuwsbriefpagina ("Credits kopen", eenmalige Mollie-betaling, bijvoorbeeld 5.000 mails voor €5).

## Aannames (voorlopig)

1. **Basis/module-grens** zoals hierboven.
2. **Proefperiode** 14 dagen per module, zonder betaalgegevens. Eén keer per module per shop.
3. **Opzeggen of niet betalen:** gegevens blijven bewaard. De module wordt verborgen (storefront) en alleen-lezen
   (admin). Lopende veilingen lopen eerst af. Opnieuw activeren zet alles terug. Er wordt nooit automatisch iets
   verwijderd.
4. **Te veel producten na downgrade:** bestaande producten blijven online. Nieuwe producten aanmaken of activeren
   kan pas weer onder de limiet.
5. **Factuurpartij** en Mollie-account van het platform: nog te bepalen (Intractief?). Nodig vanaf fase 3.
6. **Bestaande Concept500-klanten** houden hun huidige prijs (grandfathering). Hun pakket wordt via de ETL gezet.

## Bouwen: fase 1 (fundament)

Doel: de superadmin zet modules en pakketten per shop met de hand aan of uit. Elke controle zit op één plek.
Betalen komt in fase 3.

### Modulecatalogus in code

`src/server/modules/catalog.ts` (puur, geen database) beschrijft per module:
- `id`, naam, korte omschrijving, prijs;
- de admin-navigatie-items (`NavItemKey`);
- storefront-features en CMS-blokken (`requiresFeature`, bestaat al voor de nieuwsbrief);
- jobs en crons die alleen voor shops met deze module draaien;
- afhankelijkheden.

Daarnaast staan daar de pakketten (inhoud en limieten) en de extra's. Alle andere code leest uit deze catalogus.

### Datamodel

```prisma
model TenantPlan {
  tenantId      String   @id
  plan          PlanId   // START | PRO | COMPLETE
  productLimit  Int?     // null = pakketstandaard; overschrijving door superadmin
  photoLimit    Int?
  storageGb     Int?
  newsletterQuota Int?
  newsletterCredits Int @default(0) // gekochte mails, gebruikt na het maandquotum
  source        EntitlementSource // MANUAL | SUBSCRIPTION | LEGACY
  updatedAt     DateTime @updatedAt
}

model TenantModule {
  id        String   @id @default(cuid())
  tenantId  String
  moduleId  String   // id uit de catalogus
  status    ModuleStatus // TRIAL | ACTIVE | PAST_DUE | CANCELLED
  source    EntitlementSource
  trialEndsAt  DateTime?
  periodEndsAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([tenantId, moduleId])
}
```

`TenantModule` bevat alleen modules buiten het pakket (losse modules en proefperiodes). Wat een shop mag, is
pakket + losse modules met status TRIAL, ACTIVE of PAST_DUE.

### Eén controle, vijf plekken

`getEntitlements(tenantId)` geeft `{ plan, modules: Set<ModuleId>, limits }`. Het resultaat wordt per request
gecachet, net als `getRequestScope` en de storefront-instellingen.

1. **Admin-navigatie.** `SidebarNav` en het commandopalet krijgen de entitlements mee. Een module zonder recht
   blijft zichtbaar met een slotje en linkt naar de upsell-pagina (fase 2; in fase 1 een simpele "niet in je
   pakket"-pagina).
2. **Admin-pagina's.** Een `layout.tsx` per modulemap roept `requireModule(id)` aan. Zonder recht: de
   upsell-pagina in plaats van de inhoud.
3. **Services.** `assertModule(ctx, id)` gooit `ServiceError("UNAVAILABLE")`, net als de nieuwsbrief nu. Dit is
   de echte afdwinging: server actions en API-routes gaan altijd door een service.
4. **Storefront.** De bestaande `features`-map in `storefront/context.ts` krijgt alle modules. Pagina's van een
   uitgeschakelde module geven 404. Knoppen en blokken (bod doen, veilingen, foto-zoeken) worden niet getoond.
5. **Jobs en crons.** Jobs per shop stoppen vroeg zonder recht. Crons over alle shops filteren op shops met de
   module. Zo draait de embedder niet voor shops zonder Slim zoeken of Vertalingen.

### Limieten

- `productLimit` wordt afgedwongen bij aanmaken en bij activeren van een product. Concept500 telt actieve
  producten met voorraad; wij doen hetzelfde.
- `photoLimit`, opslag en het nieuwsbriefquotum lezen voortaan uit `getEntitlements` in plaats van uit
  `platform.*`.
- Melding bij de limiet: "Je pakket staat N producten toe. Upgrade of koop extra producten." met een link naar
  de upsell-pagina.

### Migratie

- Een migratie maakt voor elke shop een `TenantPlan` op basis van `platform.plan`
  (bronze → START, silver → PRO, gold → COMPLETE) en neemt de limieten mee als overschrijving.
- `platform.newsletterEnabled = true` wordt een `TenantModule` `newsletter` (ACTIVE, MANUAL), tenzij het pakket
  hem al bevat.
- **Alle bestaande shops krijgen Compleet** (bron LEGACY): vóór deze migratie was er niets afgeschermd
  behalve de nieuwsbrief, dus zo verdwijnt er niets. Limieten die in de oude `platform`-instellingen
  bewust afweken van de standaard, worden overschrijvingen. Concept500-shops via de ETL krijgen hun eigen
  pakket uit `subscription_type` (`src/server/modules/legacy.ts`).
- Nieuwe shops (platform-admin, goedgekeurde aanmelding) krijgen **Start**. Geen rij = Start.
- De velden in `platformSchema` blijven één release staan (alleen lezen) en gaan daarna weg.

### Superadmin

Op `/admin/platform/<tenant>`: pakket kiezen, limieten overschrijven, modules aan/uit en proefperiode
verlengen. Elke wijziging komt in het platform-auditlog.

### Tests

- Catalogus: elke module verwijst naar bestaande nav-keys, jobs en blokken; geen kringafhankelijkheden.
- `getEntitlements`: pakket + losse modules, statussen, overschrijvingen.
- Per module: service zonder recht → `UNAVAILABLE`; admin-route zonder recht → upsell-pagina; storefront-route
  zonder recht → 404.
- Productlimiet: aanmaken en activeren boven de limiet worden geweigerd; bestaande producten blijven online.
- Migratie: bronze/silver/gold en `newsletterEnabled` komen goed over.

### Afbouwen bij verlies van een module (gebouwd)

Algemene regel: nieuwe activiteit stopt, lopende zaken worden afgemaakt, gegevens blijven.

| Module | Blijft werken zonder module |
|---|---|
| Veilingen | lopende kavels sluiten af, winnaars betalen (`pay/[token]`), voorwaardenpagina, uitslagmeldingen |
| Beursmodus | een beurs die LIVE is: verkopen (ook offline wachtrij) en beëindigen vanuit de beursmodus |
| Bod doen | geaccepteerde biedingen afrekenen, aflopen van oude biedingen |
| Kortingscodes | codes op bestaande orders; een code in de winkelwagen kan nog verwijderd worden |
| Alerts & push | afmelden, voorkeuren uitzetten, push uitzetten |
| Herkomst & certificaten | uitgegeven certificaten blijven verifieerbaar, intrekken, documenten verwijderen of privé maken |
| Vertalingen | gegevens blijven; de shop toont alleen de basistaal |
| Slim zoeken | zoeken valt terug op tekst en facetten |

Webpush hoort bij Alerts, maar veilingmeldingen (overboden, bijna afgelopen, gewonnen) werken ook met
alleen Veilingen.

## Latere fases

| Fase | Wat | Resultaat |
|---|---|---|
| 2. Etalage | pagina "Pakket & modules" voor de eigenaar, upsell-kaarten, proefperiodes zelf starten | eigenaar probeert zelf |
| 3. Betalen | Mollie Subscriptions op het platform-account: eerste betaling maakt een mandaat, daarna maandelijks of jaarlijks incasso. Webhook zet entitlements. Platformfacturen aan shops (EU-verlegging voor buitenlandse bedrijven). 7 dagen respijt bij een mislukte betaling, met mails | echte click-and-buy |
| 4. Migratie en verfijning | Concept500-klanten via de ETL, jaarbetaling, extra's los kopen, omzet per module voor de superadmin | bestaande klanten aan boord |

Fase 1 is op zichzelf bruikbaar: verkopen kan dan al met de hand (factuur buiten het systeem).
