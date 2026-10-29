---
name: Quartermaster platform
description: Het commerceplatform voor militariahandelaren, in de categoriestandaard; elk stuk bestaat één keer.
colors:
  paper: "#ffffff"
  paper-2: "#fafaf6"
  canvas: "#ecece5"
  ink: "#1e2119"
  ink-2: "#3a3e32"
  muted: "#5f6354"
  line: "#d7d8cc"
  line-soft: "#e6e6dd"
  brass: "#7e5416"
  brass-hover: "#5f3f10"
  brass-soft: "#f1e5cc"
  olive: "#2f3526"
  olive-2: "#3e4532"
  olive-ink: "#d9dccb"
  olive-muted: "#a3a891"
  ok: "#2f6b3a"
  ok-soft: "#dcebd9"
  warn: "#7a5000"
  warn-soft: "#f5e7c4"
  crit: "#a2342a"
  crit-soft: "#f4dad6"
  info: "#2c5873"
  info-soft: "#d8e5ee"
typography:
  display:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "clamp(42px, 5.8vw, 78px)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "clamp(32px, 4.2vw, 52px)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "clamp(28px, 3vw, 38px)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  title-sm:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  price:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"ss01\""
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"ss01\""
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1
  button:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
  wordmark:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.26em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  frame: "12px"
  plan: "14px"
  pill: "99px"
spacing:
  gutter: "clamp(16px, 4vw, 56px)"
  max: "1200px"
  section: "clamp(72px, 10vw, 128px)"
  nav-height: "68px"
  stack-lg: "56px"
  stack-md: "32px"
  stack-sm: "18px"
components:
  button-primary:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.brass-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 22px"
    height: "48px"
  button-sm:
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  chip-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  chip-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  chip-crit:
    backgroundColor: "{colors.crit-soft}"
    textColor: "{colors.crit}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  chip-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  chip-mute:
    backgroundColor: "{colors.line-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  product-frame:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.frame}"
  plan-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plan}"
    padding: "28px"
  plan-flag:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "26px"
  nav:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    height: "68px"
---

# Design System: Quartermaster platform

> **Reikwijdte.** Dit document beschrijft alleen de **platformpagina's**: de landing op `PLATFORM_HOST` (`/`) en, later, de aanmeld-, verificatie- en bedankpagina's en de netwerkpagina's. Die volgen allemaal het systeem van deze landing. Bron is het ontwerpbestand `docs/design/platform-landing.html`; gebouwd in `src/app/(shop)/_platform/` (tokens `pf-*` in `src/app/(shop)/_platform/platform.css`, alleen geladen door platformpagina's, fonts in `src/lib/platform-fonts.ts`). Het certificatenblok uit het ontwerp is op verzoek van de eigenaar niet gebouwd.
>
> **Buiten de reikwijdte.** Twee aparte, bestaande systemen vallen niet onder dit document:
> - **De admin**, met schakelbare tokenthema's Depot (standaard), Field Ledger en Naval Quiet, gedefinieerd onder `[data-admin-theme]` in `src/app/globals.css`.
> - **De shop-storefront**, die alleen `--shop-*`-tokens gebruikt; presets overschrijven die via `data-shop-theme`, standaard "Gallery".
>
> De product-UI-mockups in de landing (het adminvenster, de beurstelefoon en de storefrontkaart) verbeelden het product en lenen daarvoor de tokens van deze pagina. Ze zijn geen specificatie voor de admin of de storefront zelf.

## Overview

**Creative North Star: "Het Depotregister"**

Een commerceplatform-landing in de categoriestandaard (kop, product, bewijs, prijzen, FAQ) op het afwerkingsniveau van Stripe en Shopify, in de kleuren van een goed bijgehouden depot: wit en licht getint gebroken wit als ondergrond, bijna-zwart olijfinkt voor tekst, één messingkleur voor actie en één diepe olijfband als rustpunt. Het bewijs is het product zelf: echte product-UI in kaders met een zachte schaduw, geen illustraties of icoontegels.

De dichtheid is ruim en kalm. Secties krijgen veel verticale lucht, koppen zijn in zinsnotatie en gebalanceerd, broodtekst blijft binnen 52 tot 68 tekens. Kleur doet weinig: messing alleen op acties, statuskleuren alleen binnen product-UI. Het enige echte moment van beweging is één georkestreerde statuswissel in de mechanisme-demo.

Bevestigde afwijzingen (PRODUCT.md, surface brief): geen militaire kostumering, geen generieke SaaS-taal met verlopen of icoontegels, geen beladen symbolen als decoratie.

**Key Characteristics:**
- Witte en gebroken-witte vlakken (`paper`, `paper-2`, `canvas`) gescheiden door haarlijnen, niet door schaduw.
- Messing (`brass`) is de enige actiekleur.
- Eén olijfband (`olive`) per pagina; dezelfde olijf vormt de rail en balk in product-UI.
- Barlow 600 in zinsnotatie voor koppen, Hanken Grotesk voor alles wat gelezen of bediend wordt.
- Product-UI in kaders van 12px met haarlijn en zachte frameschaduw.
- Getekende lijniconen (24-viewBox, lijn 1.6), nooit in tegels.

## Colors

Een ingetogen, warm-neutraal palet met één messing accent en een statusset die alleen in de product-UI spreekt.

### Primary
- **Depotmessing** (`brass`): de enige actiekleur. Primaire knoppen, de verkoopknop in de beurstelefoon, focusring, `accent-color`. Hover wordt **Donker messing** (`brass-hover`). **Messingwas** (`brass-soft`) is alleen de tekstselectie.

### Secondary
- **Depotolijf** (`olive`): de netwerkband (één per pagina) en de rail en schermbalk in product-UI. **Olijf licht** (`olive-2`) markeert het actieve railitem. Tekst op olijf gebruikt **Olijfinkt** (`olive-ink`) voor broodtekst en **Olijf gedempt** (`olive-muted`) voor secundaire tekst; koppen op de band zijn bijna-wit.

### Neutral
- **Papier** (`paper`): standaard paginagrond, prijskaarten, en storefrontkaarten.
- **Gebroken papier** (`paper-2`): afwisselende secties (`alt`), footer, de binnenkant van productkaders.
- **Depotgrond** (`canvas`): de onderste strook van de hero, de feitenstrook en de afsluitende CTA.
- **Olijfinkt donker** (`ink`): koppen, tekst, rand van het uitgelichte pakket, labels op `ink`-vlakken.
- **Inkt 2** (`ink-2`): sublines, sectie-intro's, navlinks, alinea's in features.
- **Gedempt** (`muted`): metadata, voetnoten, broodkruimels, secundaire regels in product-UI.
- **Haarlijn** (`line`): kaderranden, FAQ-scheidingen, secundaire knoprand, sectie-overgangen.
- **Zachte haarlijn** (`line-soft`): scheidingen binnen kaarten en lijsten, nav-rand na scrollen, `chip-mute`-vlak.

### Status (alleen in product-UI)
- **Beschikbaar** (`ok` / `ok-soft`): "For sale", "Listed"; ook de vinkjes in lijsten en de hero-kleine-regel.
- **Gereserveerd** (`warn` / `warn-soft`): "Reserved", "Blocked", offline-melding.
- **Verkocht** (`crit` / `crit-soft`): "Sold".
- **Info** (`info` / `info-soft`): "Ready to sell", landenregel in de storefront.

### Named Rules
**The One Action Colour Rule.** Messing betekent "doe dit". Het staat op knoppen en focus, nergens als decoratie, achtergrondvlak of kopkleur.

**The Status Stays Inside Rule.** De statuskleuren `ok`, `warn`, `crit` en `info` verschijnen alleen in product-UI (chips, meldingen) en als vinkje in lijsten; nooit als sectiegrond of marketingaccent.

**The One Band Rule.** De olijfband komt één keer per pagina voor, als rustpunt; de rest van het ritme wisselt tussen `paper`, `paper-2` en `canvas`.

## Typography

**Display Font:** Barlow (met system-ui, sans-serif)
**Body Font:** Hanken Grotesk (met system-ui, sans-serif), `font-feature-settings: "ss01"`
**Label/Mono Font:** IBM Plex Mono (met ui-monospace, Menlo, monospace)

**Character:** Barlow 600 geeft koppen een stevige, iets technische stem zonder stencil- of legerconnotatie; Hanken Grotesk is warm en goed leesbaar voor lange regels en bediening. Plex Mono is gereserveerd voor wat in een depot een nummer is.

**Implementatie.** Het ontwerpbestand laadt Google Fonts (Barlow 500/600/700, Hanken Grotesk 400/500/600, IBM Plex Mono 500). De Next.js-implementatie host dezelfde drie families zelf via `next/font`, met dezelfde gewichten.

### Hierarchy
- **Display** (`display`): de hero-kop, maximaal 20ch breed, gecentreerd, `text-wrap: balance`. Eén per pagina.
- **Headline** (`headline`): sectiekoppen (h2), ook op de olijfband. De afsluitende CTA gebruikt een iets grotere variant (clamp 34–58px, lh 1.04).
- **Title** (`title`): featurekoppen (h3) in twee-koloms featurerijen.
- **Title small** (`title-sm`): stappen, tijdlijn, producttitel in het adminkader. Pakketnamen 24px, FAQ-vragen 19px/1.35 in dezelfde familie.
- **Price** (`price`): het maandbedrag in prijskaarten.
- **Lead** (`lead`): sectie-intro's (max 60ch). De hero-subline is clamp(18px, 1.7vw, 21px), max 64ch.
- **Body** (`body`): broodtekst, 16px onder 600px viewport. Feature-alinea's 18px, max 52ch; FAQ-antwoorden max 68ch.
- **Label** (`label`): navlinks, dealer-login, feitenstrook, importchips.
- **Button** (`button`): alle knoppen; 15px in `button-sm`.
- **Wordmark** (`wordmark`): "Quartermaster" in hoofdletters, ruim gespatieerd (0.18em onder 600px). Dit is het logo, geen typografische stijl voor andere tekst.
- **Mono** (`mono`): voorraadnummers ("No. 50212"), de reserveringstimer, toetsaanduiding in het zoekveld.

### Named Rules
**The Sentence Case Rule.** Koppen staan in zinsnotatie met `letter-spacing: -0.015em`. Hoofdletters met ruime spatiëring zijn alleen voor het woordmerk.

**The Stock Number Rule.** IBM Plex Mono is voor voorraadnummers en tijden in product-UI, nooit voor koppen, labels of marketingtekst.

**The Tabular Price Rule.** Prijzen en tellers gebruiken `font-variant-numeric: tabular-nums`.

## Layout

Eén gecentreerde kolom van maximaal 1200px (`max`) met responsieve zijmarge (`gutter`). Secties krijgen `section` padding boven en onder; de afsluitende CTA clamp(72px, 9vw, 112px). Sectiekoppen zijn links uitgelijnd (max 720px) of gecentreerd voor prijzen, FAQ en afsluiting; de inhoud volgt op `stack-lg` (56px).

Het hero-patroon: gecentreerde kop, subline, twee knoppen naast elkaar (gap 12px), een kleine regel met vinkjes, en daaronder het productkader (max 1080px) dat door de vouw wordt afgesneden. De achtergrond splitst hard op 62% van `paper` naar `canvas` (70% onder 600px), zodat het kader op de naad staat.

Inhoudspatronen: twee-koloms featurerijen (1fr 1fr, gap clamp(32px, 6vw, 88px)) die om en om spiegelen; de mechanisme-demo (1.05fr 1fr); een moduleregister in 4 kolommen (2 onder 1080px, 1 onder 600px); een tijdlijn in 3 kolommen die onder 900px verticaal wordt; drie prijskaarten (1 kolom, max 520px onder 900px).

Breekpunten: 1080px (navlinks naar menuknop), 900px (alle tweekoloms naar één kolom, rail uit het adminkader), 600px (body 16px, dealer-login verborgen, hero-knoppen volle breedte). De sticky nav is 68px; ankers springen met 80px scroll-padding.

## Elevation & Depth

Hybride, overwegend vlak. Vlakken scheiden zich door toon (`paper`, `paper-2`, `canvas`) en haarlijnen. Schaduw is gereserveerd voor objecten die het product verbeelden (adminkader, demo, telefoon, storefront) en voor het uitgelichte pakket. Knoppen, chips en gewone kaarten hebben geen schaduw.

### Shadow Vocabulary
- **Frame** (`box-shadow: 0 1px 2px rgb(30 33 25 / .06), 0 24px 48px -16px rgb(30 33 25 / .22)`): productkaders en het uitgelichte pakket.
- **Frame on olive** (`box-shadow: 0 24px 48px -16px rgb(0 0 0 / .5)`): hetzelfde frame op de olijfband, donkerder zodat het daar leest.

### Named Rules
**The Product Floats Rule.** Alleen wat het product toont of de aanbevolen keuze is, krijgt de frameschaduw. Al het andere ligt plat op zijn grond.

## Shapes

Zacht afgeronde rechthoeken met een duidelijke rangorde in straal: 4px voor focusring en demo-label, 6px (`sm`) voor foto's en binnenpanelen in product-UI, 8px (`md`) voor knoppen, zoekveld, importchips en meldingen, 12px (`frame`) voor productkaders, 14px (`plan`) voor prijskaarten, en pillen (`pill`) voor statuschips, het pakketlabel en het slot op vervaagde foto's. De telefoon is de uitzondering (40px buiten, 30px scherm), omdat het een apparaat afbeeldt.

Randen zijn altijd 1px haarlijn (`line` of `line-soft`); `ink` als rand markeert alleen keuze (uitgelicht pakket, hover op secundaire knop) of een kolomkop in het moduleregister. Iconen zijn getekende lijnen: 24-viewBox, `stroke-width: 1.6` (2 voor vinkjes), ronde uiteinden, 16–20px, kleur `currentColor`.

## Components

### Buttons
Stevig en rustig: duidelijke vorm, geen effecten.
- **Shape:** zacht afgerond (8px), hoogte 48px, `button-sm` 40px in de nav.
- **Primary:** messing met witte tekst (`button-primary`). Eén primaire actie per blok.
- **Secondary:** wit met haarlijnrand en inkttekst (`button-secondary`); rand wordt `ink` bij hover.
- **Hover / Focus / Active:** kleurovergang 0.2s op `ease-out` (`cubic-bezier(.16, 1, .3, 1)`); focus is een 2px messing outline met 3px offset; active zakt 1px.

### Chips
- **Style:** pil van 24px, 12px/600, een stip van 6px in `currentColor`, zachte statusgrond met volle statustekst (`chip-ok`, `chip-warn`, `chip-crit`, `chip-info`, `chip-mute`).
- **State:** alleen in product-UI en de stappenlijst van het mechanisme. Inactieve stappen worden grijs (`grayscale(1)`) zodra de demo loopt.

### Cards / Containers
- **Productkader:** `paper-2`, haarlijn, 12px, frameschaduw; het hero-kader heeft alleen bovenhoeken (12px 12px 0 0) omdat de vouw het afsnijdt. Binnenin: balk `#f3f3ec`, olijfrail, panelen met 6px en `line`-rand.
- **Prijskaart:** `plan-card`, haarlijn, geen schaduw. **Uitgelicht:** rand `ink`, frameschaduw en een `plan-flag`-pil die de rand overlapt, met een feitelijke zin over het pakket.
- **Internal Padding:** 28px (24px onder 600px) voor kaarten, 22px voor de demo.

### Inputs / Fields
- **Style:** alleen als product-mockup aanwezig (netwerkzoekveld): 46px, wit, `line`-rand, 8px, icoon in `muted`. Formulieren op de aanmeldpagina's nemen deze vorm over en gebruiken de messing focusring.

### Navigation
- **Style:** sticky, 68px, wit op 92% met `backdrop-filter: saturate(1.4) blur(10px)`; de onderrand wordt pas `line-soft` na 8px scrollen. Woordmerk links, links in `label` (`ink-2`, hover `ink`), rechts dealer-login en `button-sm`.
- **Mobile:** onder 1080px een 40px menuknop met haarlijn; het menu klapt open onder de balk als lijst met `line-soft`-scheidingen, sluit op Escape en bij klik op een link.

### FAQ
Native `details` tussen `line`-haarlijnen, vraag in Barlow 600 19px, plus-icoon dat 45 graden draait (0.3s, `ease-out`). Antwoord in `ink-2`, max 68ch.

### Mechanisme-demo (signature)
Eén voorraadregel, drie kanalen (webshop, netwerk, beurs). "Simulate a checkout" zet alle drie de rijen tegelijk op gereserveerd met een lopende timer in mono, daarna samen op verkocht. Rijen krijgen een getinte grond (`#fdf8ec` gereserveerd, `#fbf0ee` verkocht, 0.45s); chips flippen in 0.5s van vervaagd en 92% schaal naar scherp, op `ease-out`. Eén georkestreerde statuswissel; geen andere scroll- of entree-animaties op de pagina. Bij `prefers-reduced-motion` vallen alle transities en animaties weg.

## Do's and Don'ts

### Do:
- **Do** gebruik `brass` voor de primaire actie en de focusring, en voor niets anders.
- **Do** toon het product in een kader met `rounded.frame` (12px), `line`-haarlijn en de frameschaduw, met echte productteksten en voorraadnummers.
- **Do** wissel secties af tussen `paper`, `paper-2` en `canvas`, gescheiden door 1px haarlijnen, met hoogstens één `olive`-band.
- **Do** zet koppen in Barlow 600 in zinsnotatie met `-0.015em` en `text-wrap: balance`.
- **Do** gebruik getekende lijniconen (lijn 1.6, ronde uiteinden) inline naast tekst.
- **Do** host Barlow, Hanken Grotesk en IBM Plex Mono zelf via `next/font` in de implementatie.

### Don't:
- **Don't** gebruik statuskleuren (`ok`, `warn`, `crit`, `info`) buiten product-UI en vinkjes.
- **Don't** zet iconen in tegels of gekleurde vierkanten; geen icoontegel-featuremuren.
- **Don't** gebruik verlopen als decoratie; de hero-achtergrond is een harde naad tussen twee vlakken, geen verloop.
- **Don't** gebruik militaire kostumering of beladen symbolen als decoratie.
- **Don't** geef knoppen, chips of gewone kaarten een schaduw; schaduw is voor productkaders en het uitgelichte pakket.
- **Don't** gebruik IBM Plex Mono voor koppen, labels of marketingtekst.
- **Don't** behandel de product-mockups als specificatie voor de admin of de storefront; die hebben hun eigen systemen.
