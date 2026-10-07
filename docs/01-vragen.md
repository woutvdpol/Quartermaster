# Open vragen — Quartermaster

Gebundeld uit de drie analyses. Antwoorden bepalen schema, scope en volgorde.

## A. Strategie (blokkerend voor fase 0)
1. **Eén shop of platform?** Wordt Quartermaster jouw eigen militariashop, of weer een white-label product voor meerdere dealers (zoals Concept500 met bronze/silver/gold)? → bepaalt multi-tenancy, abonnementen, settings-scheiding.
2. Zo ja platform: hoeveel bestaande Concept500-installaties moeten over, en mogen die tegelijk of per shop?
3. **Database**: PostgreSQL (advies) akkoord, of moet het MariaDB/MySQL blijven?
4. **Hosting**: blijft het Plesk, of mag het naar Docker/VPS (Coolify), Vercel of iets anders?
5. Talen: alleen Engels (huidig), of NL/DE/EN?

## B. Admin
6. Rollen: `admin` (Intractief/superuser) vs `owner` behouden? Extra rol voor personeel (bv. alleen orders inpakken)?
7. 2FA verplicht voor admin-accounts?
8. Fulfilment-status (ingepakt/verzonden) + track & trace + "verzonden"-mail gewenst? Welke vervoerder (PostNL / Sendcloud / MyParcel)?
9. **Facturen**: nodig? Margeregeling, normaal btw, of beide per product?
10. Orders hard verwijderen toestaan, of alleen annuleren/archiveren (bewaarplicht)?
11. Productstatussen: wat betekenen INACTIVE / ARCHIVED / NOT_IN_SHOP / SOLD / STOLEN voor jou? Moet auto-archiveren (oude verkochte items) aan?
12. Wordt inkoopadministratie (herkomst, inkoopprijs) gebruikt? Marge-rapportage gewenst?
13. Product-import: gebruikt? Welk bestandsformaat? Welke exports zijn nodig (orders → boekhouding? welk pakket?)
14. Nieuwsbrief: eigen verzending houden, of naar dienst (Mailchimp/Brevo/Resend) met import van abonnees?
15. Matomo (stats.concept500.com) houden voor dashboard?

## C. Shop & checkout
16. Welke betaalmethoden zijn live? PayPal apart of via Mollie? Contant/bankoverschrijving nog nodig?
17. Betalen in vreemde valuta echt gewenst, of blijft valuta alleen weergave?
18. Reservering: hoe lang mag een item in een mandje vastgehouden worden? Layaway/aanbetaling gewenst?
19. Compliance: welke landen/categorieën hebben weergave- of verzendbeperkingen (§86a, gedeactiveerde wapens)? "Blur voor gasten" behouden of land-gebaseerd maken?
20. Leeftijdsverificatie: wettelijke eis (welke categorieën) of alleen disclaimer? Guest checkout blijven toestaan?
21. Verzending: model regio × gewichtsklasse behouden, of zones op land + verzekerde verzending?
22. Moeten huidige URL's exact blijven, of zijn 301-redirects prima?

## D. Data & migratie
23. Alle historische data mee (verkochte/gearchiveerde producten + foto's, alle orders, klantaccounts)?
24. Kan ik een **geanonimiseerde productiedump** krijgen om ETL en prijs-bug (`order_details.price` euro vs cent) te verifiëren? Globale aantallen (producten, orders, users)?
25. Staat er nog ongemigreerde data in de oude pre-Laravel database (`old_database`)?
26. `products.product_id` (start 5001) vs StockCode (`id`) vs `sku`: welke is leidend voor jou?

## E. Scope & proces
27. Welke vernieuwingen (plan §6) wil je in de eerste live-versie, welke later?
28. Design-richting admin (zie mockups) akkoord? Shop: verder op het messing/leer-redesign, of nieuwe richting?
29. Akkoord dat admin eerst gebouwd en getest wordt op een datakopie, en admin + shop **samen** live gaan?
30. Mag ik `git init` doen, remote `woutvdpol/Quartermaster` koppelen en de docs als eerste commit pushen?
