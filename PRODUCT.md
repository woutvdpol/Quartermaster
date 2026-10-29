# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primair: de militariahandelaar met een bestaande webshop.** Klein bedrijf (1–3 mensen), nu op WooCommerce, Shopify of een eigen oplossing. Verkoopt unieke stukken (insignes, uniformen, helmen, documenten), elk stuk één keer. Wil overstappen naar een platform dat echt voor deze handel is gebouwd.
- Secundair (bestaat in het product, niet de focus van de landingspagina): beurshandelaren, verzamelaars die gaan verkopen, bestaande Concept500-installaties die migreren.
- Kopers/verzamelaars zijn de gebruikers van de shops zelf, niet van het platform.

## Product Purpose

Quartermaster is een multi-tenant webshopplatform voor militariahandelaren. Elke handelaar krijgt een eigen shop op een eigen domein, met admin, betalingen (Mollie), verzending per land en een setup-wizard. Succes: een handelaar verhuist zijn voorraad, verkoopt zonder dubbele verkopen en hoeft geen losse plug-ins aan elkaar te knopen.

## Positioning

**Elk stuk is uniek en wordt nooit twee keer verkocht.** Een stuk staat één keer in de voorraad, wordt 15 minuten gereserveerd zodra iemand afrekent, en is op hetzelfde moment verkocht in de webshop, op de beurs (beursmodus) en in de veiling. Betaling wordt via een webhook afgerond, dus ook als de koper de tab sluit. Generieke shopsoftware is gebouwd voor voorraad in aantallen; Quartermaster voor stukken van één.

## Operating Context

- Handelaren kopen in, fotograferen, beschrijven en zetten stukken online; ze verkopen ook op beurzen (telefoon/tablet, QR-labels, offline) en via veilingen.
- Kopers zitten in meerdere landen; regels voor gevoelige items verschillen per land (blur + inloggen, compliance per land).
- Aanmelden gaat via het platform: de superadmin kiest de modus (aanvragen, wachtlijst of gratis proef van standaard 30 dagen). In proefmodus komt de handelaar na e-mailbevestiging direct in de setup-wizard.
- Overstappen: de wizard importeert WooCommerce-CSV, Shopify-CSV en Concept500.

## Capabilities and Constraints

- Basis in elk pakket: producten, categorieën, facetten, orders, Mollie-checkout, klanten, verzendzones per land, facturen, CMS-pagina's, thema (presets), SEO en feeds, compliance per land, setup-wizard, auditlog.
- Modules: veilingen, beursmodus, bod doen, kortingscodes, nieuwsbrief, alerts & push, inkoopaanvragen, slim zoeken (ook op foto), vertalingen NL/DE, inzichten, herkomst & echtheidscertificaten met QR.
- Quartermaster-netwerk: één zoekpagina over de voorraad van alle deelnemende shops; opt-in, gratis; koper rekent af in de shop van de handelaar.
- Pakketten (per maand, excl. btw; jaarbetaling = 10 × maandprijs): **Start €29** (basis, 100 producten), **Pro €59** (+ bod doen, kortingscodes, nieuwsbrief, alerts, inzichten; 500 producten), **Compleet €99** (alles, onbeperkt). Prijzen komen uit `docs/modules.md` en mogen op de landingspagina staan (eigenaar, 29-10-2026).
- Betalen voor het platform zelf (abonnement via het platform) bestaat nog niet.
- AI is lokaal (eigen containers, geen externe API); de AI-plaatsingsassistent is geparkeerd en mag niet beloofd worden.
- Engelstalige UI; shops ook in NL/DE. Domeinnaam voor platform en netwerk is nog niet gekozen.

## Brand Commitments

- Naam: **Quartermaster**.
- De platformpagina's (landing, aanmelden) gebruiken eigen Quartermaster-styling, los van de shop-thema's.
- **Platformpagina's volgen bewust de categoriestandaard** (landing, aanmelden, netwerk): de vertrouwde opbouw van een commerceplatform, zonder ironie of verstopte eigenaardigheden, op het afwerkingsniveau van Shopify, Lightspeed/Shopware, Linear/Stripe en Squarespace (eigenaar, 29-10-2026).

## Evidence on Hand

- Productfeiten en prijzen hierboven (bron: `docs/02-besluiten.md`, `docs/modules.md`, `docs/network.md`).
- **Niet beschikbaar, niet verzinnen:** testimonials, klantnamen, logo's van handelaren, aantallen shops/omzet, persvermeldingen. Concept500 en de demo-shop worden op de landingspagina niet genoemd (eigenaar, 29-10-2026).
- Demo-productfoto's zijn gegenereerd (`scratchpad/demo-shop`), geen echte voorraadfoto's.

## Product Principles

1. **Eén stuk, één waarheid.** Elke feature respecteert dat een item uniek is: één voorraadstand over alle kanalen.
2. **Vakwerk boven generiek.** Liever één ding dat precies klopt voor militaria dan een algemene feature.
3. **Eerlijk en controleerbaar.** Herkomst, certificaten en audit; geen beloftes die het product niet waarmaakt.
4. **Overstappen zonder pijn.** Import, wizard en proef halen drempels weg voor de handelaar die al een shop heeft.
5. **Gevoelig onderwerp, neutrale vorm.** Militaria documenteert geschiedenis; de presentatie verheerlijkt niets en gebruikt geen beladen symbolen als decoratie.
