# Aanmeldmodus: aanvragen, wachtlijst of proef

De superadmin kiest op `/admin/platform/applications` hoe nieuwe handelaren binnenkomen. Besluiten: `docs/02-besluiten.md`,
"Aanmeldmodus". Ontwerp: `docs/design/signup-modes.html`.

| Modus | Wat de handelaar meemaakt |
|---|---|
| **Aanvragen** (`APPLY`, standaard) | formulier → e-mail bevestigen → superadmin keurt goed → uitnodigingsmail → wachtwoord → wizard |
| **Wachtlijst** (`WAITLIST`) | formulier → e-mail bevestigen → op de wachtlijst → superadmin nodigt uit → uitnodigingsmail → wachtwoord → wizard |
| **Proef** (`TRIAL`) | formulier → e-mail bevestigen → shop wordt meteen aangemaakt → direct wachtwoord kiezen → wizard |

- De keuze staat in `PlatformConfig` (één rij, id 1; geen rij = aanvragen, 30 dagen proef).
- Elke aanvraag onthoudt de modus waarin hij is verstuurd (`DealerApplication.signupMode`). Wisselen van modus
  verandert niets aan aanvragen die al binnen zijn.
- In alle drie de modi blijft de e-mailbevestiging verplicht, net als de rate limits, Turnstile, de honeypot en de
  automatische controles.
- De teksten van `/apply`, de bedankpagina, de bevestigingsmail en de knop op de landingspagina volgen de modus.

## Wachtlijst

- Een aanmelding krijgt status `WAITLISTED`. Per aanmelding gaat er **geen** mail naar de superadmins.
- De superadmin ziet de tab "Waitlist", oudste eerst, met de plek in de rij. De aanmelder ziet die plek niet.
- "Invite & create shop" doet hetzelfde als goedkeuren (`approveApplication`): shop, subdomein, pakket Start,
  eigenaar en uitnodiging. Afwijzen kan ook, met een reden.

## Proef

### Shop aanmaken bij de bevestiging

`verifyApplicationEmail` (`src/server/onboarding/applications.ts`) maakt bij een aanvraag uit de proefmodus meteen de
shop aan, in dezelfde transactie als goedkeuren:

- `Tenant.trialEndsAt` = nu + het aantal proefdagen, pakket **Compleet**;
- `reviewedById` blijft leeg; het auditlog toont `dealer_application.trial_started`;
- de bevestigingsknop stuurt de handelaar direct door naar `https://<shop>/admin/accept-invite?token=…`. De
  uitnodigingsmail gaat ook nog, als reserve voor wie het tabblad sluit;
- de superadmins krijgen de mail "New trial shop" en kunnen de shop blokkeren (status Suspended).

De proef start **niet automatisch** (`autoTrialBlockers` in `src/server/onboarding/trial-rules.ts`) als:

- het e-mailadres al bekend is, of het domein een wegwerpdomein is;
- er al een shop of aanvraag met een vergelijkbare naam bestaat;
- het KvK-nummer ongeldig is of al in een andere aanvraag staat;
- er in 24 uur al 25 proeven automatisch zijn gestart.

De aanvraag blijft dan `PENDING`. De reden staat in de interne notitie en de superadmins krijgen de gewone
melding. Keurt de superadmin hem goed, dan krijgt de shop alsnog de proef.

### Tijdens en na de proef

- In de admin staat bovenaan een balk "Free trial · N days left". Na de proef: "Your free trial has ended".
- De cron `trials.tick` (elk uur) mailt de eigenaar op 7 dagen en op 1 dag voor het einde, en bij het einde.
  `Tenant.trialNotices` houdt bij wat al is verstuurd. Bij het einde krijgen ook de superadmins een mail.
- **Na de proef is de winkel dicht en blijft de admin open.** De poort is dezelfde als "Opening soon"
  (`src/server/storefront/launch.ts`, reden `closed`):
  - bezoekers zien "Tijdelijk gesloten";
  - shopacties (winkelwagen, afrekenen, account, bieden) werken niet;
  - de sitemap en feeds zijn leeg en de shop valt uit het netwerk;
  - de eigenaar ziet de shop met de balk "Trial ended".
- De superadmin heeft op `/admin/platform/<shop>` drie knoppen:
  - **Extend trial:** standaard +14 dagen. Een verlopen proef telt vanaf nu, en de winkel gaat weer open.
  - **End trial now.**
  - **Convert to paid shop:** de einddatum verdwijnt. Het pakket stel je in met het pakketformulier.
- Er is nog geen betaling via het platform. De handelaar antwoordt op de proefmail en de superadmin zet de shop om.

## Code

- **Instelling:** `src/server/platform/signup.ts`.
- **Proefbeheer:** `src/server/platform/trials.ts`.
- **Regels:** `src/server/onboarding/trial-rules.ts` (puur, met unit-tests).
- **Cron:** `src/server/onboarding/trials.ts`.
- **Mails:** `src/server/mail/builders-onboarding.tsx` (`dealer-application-verify` per modus, `trial-notice`,
  `platform-admin-notice` met `trial` / `trial-ended`).
- **Admin-balk:** `src/components/admin/TrialBanner.tsx`.
- **Tests:** `tests/integration/onboarding.int.test.ts` ("sign-up modes") en `tests/integration/coming-soon.int.test.ts`
  ("trial ended").
