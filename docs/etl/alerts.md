# ETL — Alerts ("notify me": SavedSearch, AlertDelivery)

**Bron in Concept500: geen — nieuwe functie.**

- `SavedSearch` en `AlertDelivery` worden bij de migratie **leeg** opgeleverd. Er is in de legacy-database
  niets dat op opgeslagen zoekopdrachten of "bericht bij binnenkomst" lijkt.
- **Nieuwsbriefabonnees worden NIET omgezet naar alerts.** Een nieuwsbriefaanmelding is toestemming voor de
  nieuwsbrief, niet voor zoekalerts; alerts vragen eigen (double opt-in) toestemming per zoekopdracht.
- Verlanglijstjes (`WishlistItem`, eigen ETL) krijgen automatisch "weer beschikbaar"- en "prijsdaling"-mails
  voor ingelogde klanten. De ETL hoeft daarvoor niets te doen; er worden **geen** `AlertDelivery`-rijen
  aangemaakt voor bestaande verlanglijst-items (anders zou de eerste echte melding onterecht onderdrukt
  worden).
- Let op bij het importeren van producten: zet `publishedAt` op de legacy-datum (niet op "nu"). De
  `alerts.scan`-cron koppelt producten die in de laatste 30 minuten gepubliceerd zijn aan actieve alerts;
  omdat er na de migratie nog geen alerts bestaan gebeurt er niets, maar draai de product-ETL niet na het
  live gaan met `publishedAt = now()`.
- Defaults: geen. (Bij handmatig aanmaken: `email` lower-case, `query` = `{ q, categoryId, tagIds[],
  facetValueIds[], priceMin, priceMax }` met prijzen in centen, `confirmedAt` gezet voor actieve alerts.)
