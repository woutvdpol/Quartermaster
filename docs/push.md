# Pushmeldingen (web push) en installeerbare shop

Besluit: `02-besluiten.md` › "Innovatieronde 2". Ontwerp: `docs/design/fair-archive-push-network/Push.dc.html`.

## Wat

Alleen voor **ingelogde klanten**, en alleen voor drie dingen:

| Melding | Wanneer | Instelling |
|---|---|---|
| Nieuw stuk voor een opgeslagen zoekopdracht | direct bij publicatie (binnen ~1 minuut) | per zoekopdracht: *Push* of *E-mail* (`SavedSearch.push`) |
| Prijsdaling op de verlanglijst | samen met de bestaande prijsdaling-mail | `Customer.pushWishlist` (standaard aan) |
| Reservering verloopt bijna | ~3 minuten voor de 15-minuten-reservering afloopt, zolang de klant nog niet afrekent | `Customer.pushReservation` (standaard aan) |

Geen push bij biedingen of andere mails.

## Hoe het werkt

- **Aanmelden**: na "Save search" vraagt het dialoogvenster "Push alert on this phone" of "E-mail". Push = de browser vraagt toestemming, registreert `/sw.js` en slaat het abonnement op (`PushSubscription`, uniek per endpoint; hetzelfde apparaat opnieuw = bijwerken). Daarnaast staat alles onder **Account › Alerts**: per zoekopdracht push of e-mail, verlanglijst- en reserveringsmeldingen, stille uren, maximum per dag en "Turn off push on this device".
- **Push of e-mail per zoekopdracht**: *Push* zet `push = true` en `frequency = INSTANT`; dan **vervangt** de push de directe e-mail. Heeft de klant (nog) geen apparaat, of staat push uit op het platform, dan gaat gewoon de directe e-mail. Een zoekopdracht met `push = true` en `DAILY`/`WEEKLY` (kan het datamodel, niet de UI) krijgt de push direct én later de digest. Prijsdalingen: de mail blijft, de push komt erbij.
- **Bezorgen**: elk event wordt een `PushMessage` (uniek op klant + `dedupeKey`, dus één push per event) en een job `push.send`. Die stuurt via `web-push` naar alle apparaten van de klant; 404/410 van de pushdienst = abonnement weg → rij verwijderd. Alleen tijdelijke fouten → retry.
- **Stille uren** (minuten na middernacht in de tijdzone van de shop): een push wacht tot de stille uren voorbij zijn (`queuedFor`); de cron `push.flush` (elke 5 min) zet hem dan opnieuw klaar. Een reserveringsmelding in stille uren vervalt (te laat is nutteloos).
- **Maximum per dag** (standaard 5; reserveringsmeldingen tellen niet): meer pushes wachten tot de volgende dag. Niet-verstuurde pushes ouder dan 48 uur vervallen.
- **Reservering**: cron `push.reservations` (elke minuut) zoekt winkelwagens van ingelogde klanten waarvan de eerste reservering binnen 3 minuten afloopt en die niet in de checkout zitten. Eén melding per winkelwagen per vervaltijd (`reservation:<cartId>:<minuut>`).
- **Service worker** `public/sw.js`: alleen `push` (melding met titel, tekst, shopicoon) en `notificationclick` (opent/focust de link). Geen fetch-handler, geen offline-cache: de shop blijft even snel. Hij wordt pas geregistreerd als een klant push aanzet. De proxy slaat `/sw.js` over; de CSP heeft `worker-src 'self'`.
- **Installeerbaar**: `src/app/manifest.ts` (naam van de shop, `display: standalone`, `start_url: /`) met iconen uit `/pwa-icon/{180,192,512,maskable}`: het shoplogo op een licht vlak, zonder logo een letter in de themakleur. Dat icoon staat ook in de melding.

## iPhone / iPad

Web push werkt op iOS/iPadOS 16.4+ **alleen vanuit de beginschermapp**. In Safari toont de shop daarom geen toestemmingsvraag maar de stappen: Deel › Zet op beginscherm › open de shop vanaf het beginscherm, log in en zet push aan onder Account › Alerts. De beginschermapp heeft eigen cookies: de klant moet daar opnieuw inloggen.

Android, Chrome/Edge/Firefox op desktop en Safari op macOS werken direct in de browser.

## Configuratie

| Variabele | Toelichting |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Eén sleutelpaar voor het hele platform: `npx web-push generate-vapid-keys`. Abonnementen horen bij het domein van de shop; alle shops tekenen met dezelfde sleutel. |
| `VAPID_SUBJECT` | `mailto:`-adres (of `https://`-URL) van de beheerder; pushdiensten nemen contact op bij problemen. |

Zonder deze drie staat push **uit**: de shop verbergt elke push-optie en alerts blijven e-mail. Web én worker hebben ze nodig (k8s: Secret `quartermaster-secrets`, zie `deploy.md` §5). Lokaal staat een dev-sleutelpaar in `.env`. **Niet roteren** zonder reden: een nieuw paar maakt alle bestaande abonnementen ongeldig (apparaten moeten opnieuw aanmelden; de browser doet dat bij de volgende keer "Turn on").

## Privacy

- We bewaren per apparaat alleen het push-endpoint, de twee sleutels van de browser en de user-agent (om apparaten te herkennen). Geen locatie, geen tracking.
- De inhoud van een melding is versleuteld (Web Push-encryptie) en bevat alleen titel, korte tekst, het shopicoon en een link binnen de shop. Nooit productfoto's.
- Afmelden: "Turn off push on this device" (verwijdert het abonnement), toestemming intrekken in de browser (de volgende push geeft 410 → rij weg), of het account verwijderen (cascade).

## Code

- `src/server/push/` — `rules.ts` (stille uren, maximum, dedupe-sleutels, payload; puur), `service.ts` (abonnementen, voorkeuren, `queuePush`), `send.ts` (worker: `push.send`, `push.flush`), `reservations.ts`, `jobs.ts`.
- Koppelingen: `src/server/alerts/matching.ts` (INSTANT-push), `src/server/alerts/wishlist-alerts.ts` (prijsdaling).
- Shop: `src/components/shop/push/` (dialoogkeuze, accountinstellingen, browserkant), `public/sw.js`, `src/app/pwa-icon/[size]/route.tsx`.
