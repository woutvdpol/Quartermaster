# ETL — Engagement (leads, Turnstile, recent bekeken)

Fase 5-onderdelen: "Sell your collection"-leads (`Lead`, tabel `leads`), Cloudflare Turnstile en
"Recently viewed". Bronnen: `docs/analysis/02-data-model.md`, `docs/analysis/03-shop-and-integrations.md`, `.local/main.sql`.

## Leads (`Lead`)
**Geen legacy-data — nieuwe feature.** Concept500 kende geen "verkoop aan ons"-formulier en
geen tabel waar zulke aanvragen in stonden. De ETL maakt dus géén `Lead`-rijen aan.

## Contactformulier (legacy `/contact`)
- Legacy: POST `/contact` (Turnstile) → `Mail::raw` naar `settings.email`. Berichten werden
  **alleen gemaild, niet opgeslagen** → er is niets te migreren.
- Wat wél mapt: de instelling `toggle_contact_form` en `settings.email`.
  - `settings.email` → `general.contactEmail` (al onderdeel van de settings-ETL); dit is ook het
    adres waar lead-notificaties heen gaan (`mail.orderNotificationEmail` → `general.contactEmail`).
  - `toggle_contact_form` heeft (nog) geen eigen setting in Quartermaster; contactpagina = CMS-
    systeempagina `CONTACT` (content-ETL). Niet migreren, wel noteren in het ETL-log.
- Legacy `contents.contact` (JSON bij de contactpagina) hoort bij de content-ETL, niet hier.

## Feedback (legacy admin "Feedback")
- Het admin-feedbackformulier ging "rechtstreeks naar het Concept500-team" (mail naar de
  leverancier), niet naar de shop-eigenaar, en werd niet in de shop-database opgeslagen.
- **Mapt op niets** — geen tabel, geen data. Overslaan.

## Turnstile
- Legacy gebruikte `ryangjchandler/laravel-cloudflare-turnstile` (nieuwsbrief + contact). De
  sleutels staan in de legacy `.env`, niet in de database → **geen ETL**. Bij livegang
  `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` per omgeving instellen (één paar
  per platform; tenant-domeinen toevoegen aan de widget-hostnames in Cloudflare).

## Recently viewed
- Puur client-side (localStorage per shop-host), geen serveropslag → **geen ETL**.

## Defaults die de ETL moet zetten
Geen. (Leads starten leeg; `Lead.status` default `NEW`, `photos` default `[]`.)
