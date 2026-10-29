# Admin-rondleiding bij de eerste keer inloggen

Een eigenaar die voor het eerst in de admin komt, krijgt een korte spotlight-rondleiding over het dashboard en het
menu. Besluiten: `docs/02-besluiten.md`, "Admin-rondleiding". Ontwerp: `docs/design/admin-tour.html`.

## Wanneer

- **Automatisch** voor een eigenaar (`OWNER`) zonder `User.adminTourSeenAt`, alleen op `/admin/dashboard`.
  - In de setup-wizard (`/admin/setup`) start hij dus nooit.
  - Een nieuwe shop gaat na "Go live" naar het dashboard, en daar begint de rondleiding.
- **Telt als gezien zodra hij opent.** Overslaan, afronden of herladen halverwege start hem niet opnieuw.
- **Opnieuw starten:**
  - Account → "Restart tour";
  - in het ⌘K-palet "Take the admin tour";
  - beide openen `/admin/dashboard?tour=1`.
- **Superadmins** krijgen hem nooit automatisch, maar kunnen hem wel zelf starten met `?tour=1`.
- **Bestaande eigenaren:** wie vóór deze release al had ingelogd, staat via de migratie op gezien. Eigenaren die
  nog nooit inlogden, zoals gemigreerde Concept500-handelaren, krijgen hem wel.

## Stappen

1. Welkom (met de shopnaam).
2. Menu.
3. Zoeken / ⌘K.
4. To do today.
5. New product.
6. Orders.
7. Website (Theme).
8. Payment methods.
9. Vergrendelde modules.
10. Account.
11. Klaar, met de link "View your shop".

Een stap waarvan het element niet op de pagina staat, valt weg. Zo heeft een shop op Compleet geen slotjes en dus
geen stap "Locked items". Op een telefoon zit het menu achter de menuknop. Die stappen worden daar een kaart in het
midden van het scherm, zonder spotlight.

## Bediening en toegankelijkheid

- Toetsen: Volgende / Terug, pijltjes, Enter en Esc.
- De focus blijft in de kaart, de stappenteller wordt voorgelezen (`aria-live`) en `prefers-reduced-motion` zet de
  animatie uit.
- De kaart wordt in de thema-root van de admin (`[data-admin-theme]`) gerenderd. Daar staan de kleuren en
  lettertypes, zodat hij alle drie de admin-thema's volgt.

## Code

- **Stappen en filter:** `src/components/admin/tour/steps.ts`, puur, met unit-tests.
- **Component:** `src/components/admin/tour/AdminTour.tsx`, in de admin-layout.
- **Doelen:** `data-tour="…"` op het menu, de zoekknop, Account, de knop New product en To do today.
- **Gezien opslaan:** `markAdminTourSeen` in `src/server/users`, aangeroepen via `markAdminTourSeenAction`.
- **Sessie:** `SessionUser.adminTourSeen`, uit dezelfde query als de rest van de sessie.
- **Test:** `tests/integration/users.int.test.ts`, "admin tour".
