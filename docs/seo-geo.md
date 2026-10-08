# SEO en GEO

Doel van de eigenaar: "SEO en GEO optimaliseren". GEO (generative engine optimisation) betekent hier dat ChatGPT, Perplexity, Google AI Overviews, Claude en vergelijkbare diensten de shops vinden en ze correct citeren. Dit document beschrijft de audit, de genomen besluiten, wat er gebouwd is en een checklist. Alles werkt per tenant-shop, en de tenant wordt bepaald door de host.

## 1. Audit: wat er al was (stand 2026-10-08)

| Onderdeel | Gevonden | Probleem |
|---|---|---|
| `generateMetadata` | Op home, catalogus, categorie, facet-landingspagina, product, CMS-pagina, archief en `/sell`. Privé-pagina's hadden een statische `robots: noindex` | Beschrijvingen werden hard afgekapt met `.slice(0,160)`, vaak midden in een woord. Pagina's met een eigen `openGraph` verloren `siteName` en de banner, omdat Next `openGraph` als geheel vervangt. `robots: undefined` op product- en catalogpagina's overschreef de `noindex` van de layout bij "coming soon". Hergesorteerde lijsten (`?sort=`) waren indexeerbaar. `/apply/thanks` en `/apply/verify` waren indexeerbaar |
| JSON-LD | `Product`+`Offer` (zonder brand, verzending of retourbeleid), `BreadcrumbList` (via `Breadcrumbs`), `Organization` en `WebSite` alleen op home | `Organization` zonder adres, contactPoint of sameAs. `reserved` → `LimitedAvailability` (onjuist). Geen `ItemList` op catalogpagina's. OG-afbeelding gebruikte de afmetingen van het origineel in plaats van de 2000w-variant |
| `sitemap.ts` | Eén platte sitemap met prelaunch-check | Geen sitemap-index en geen afbeeldingen. `ACTIVE` met voorraad 0 kwam erin (die pagina's geven 404). Categorieën met een inactieve ouder kwamen erin. Niet gecachet: bij elk verzoek 4 queries |
| `robots.ts` | Per host. Platform: alles disallow. Prelaunch: alles disallow | Geen AI-crawlerbeleid. `/wishlist`, `/order/` en `/offer/` ontbraken |
| `manifest.ts` | Per shop | Prima |
| Redirects | `src/server/redirects` (oude Concept500-URL's, eigenaar-redirects, 308) | Prima; `redirectOrNotFound` blijft het 404-pad |
| Productfeit-HTML | Specificatietabel en facetten worden server-side gerenderd | Herkomst (provenance) stond in een `<Suspense>`-grens en kwam daardoor als gestreamd, verborgen fragment achteraan de HTML |
| Streaming metadata | Next 16 streamt metadata naar `<body>` voor alle user agents behalve een vaste lijst "HTML-limited bots" | AI-crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot …) staan niet in die lijst en kregen canonical en description dus niet in `<head>` |
| Merchant feed, llms.txt, markdown-alternates | Ontbraken | — |
| Coming soon | Een andere agent heeft de "coming soon"-staat gebouwd (`src/server/storefront/launch.ts`): layout `noindex`, robots disallow en een lege sitemap | Alle nieuwe SEO-routes respecteren dit (zie §3.6) |
| FAQ-content | Bestond niet (er was geen FAQ-blocktype) | Opgelost: blocktype `FAQ` met `FAQPage`-markup (zie §3.8) |
| hreflang | Eén taal (en) | Niet toegevoegd (bewust) |

## 2. Besluiten

1. **Canonical en indexering van lijsten.** Canonical is het schone pad. Pagina 2 en verder is self-canonical (`?page=N`) en indexeerbaar. Google gebruikt `rel=prev/next` niet meer en vraagt om self-referencing canonicals ([Google: pagination](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading)). Zoeken, filters, een niet-standaard sortering, "load more" (`show`) en lijstweergave krijgen `noindex, follow`, met de canonical naar de schone lijst. Precies één facetfilter op `/shop` (`/shop?f=period.ww2`) toont dezelfde lijst als de landingspagina `/shop/facet/period/ww2`. Die variant zet daarom de canonical naar de landingspagina in plaats van `noindex`.
2. **Veilige filterdiepte.** De eigenaar stelde "gefilterde combinaties boven een veilige diepte" als eis. Die diepte is 1 facet, en alleen via de landingspagina's. robots.txt blokkeert crawl-traps: `?q=`, `?sort=`, `?view=`, meerdere `f=`, meerdere `tag=` en de themapreview-parameter.
3. **`robots` alleen zetten als het nodig is.** Een pagina zet nooit `robots: undefined`, want dat wist de `noindex` van de layout (coming soon of themapreview). Themapreviews krijgen daarnaast `X-Robots-Tag: noindex, nofollow` vanuit de proxy.
4. **Verkochte items.** Het bestaande besluit uit docs/analysis/03 §6 blijft staan: verkochte items blijven bereikbaar (HTTP 200) met `availability: SoldOut`. Staat het publieke archief aan (`catalog.publicArchive`), dan zijn ze indexeerbaar en staan ze in de sitemap. Staat het archief uit, dan blijft de pagina bestaan (orderlinks, wishlists) maar met `noindex, follow`, en staat ze niet in sitemap of feed. Gearchiveerde, verwijderde of draft-producten → 404 of een redirect via `redirectOrNotFound`. Geen 410: unieke items komen niet terug, maar een 404 wordt even snel uit de index verwijderd, en de bestaande redirect-regels gaan voor.
5. **Prijs bij verkochte items.** Zonder `showPriceWhenSold` krijgt een verkocht item geen `Offer`. Een `Offer` zonder prijs is ongeldig. Gevolg: Search Console meldt zo'n pagina als "Product snippet zonder offers". Dat is geen penalty. Wie rich results in het archief wil, zet de prijs aan.
6. **Beschikbaarheid.** `available` → `InStock`, `sold` → `SoldOut`, `reserved` (status RESERVED of in iemands mandje) → `OutOfStock`. schema.org kent wel `Reserved`, maar Google accepteert die waarde niet in merchant listings ([lijst](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)).
7. **Gevoelige items (`Product.blurred`).** Nooit indexeren, nooit in sitemap, feed, llms.txt of ItemList. Ook geen OG-kaart.
8. **Compliance.** In sitemap en feed blijven items weg die een regel verbergt in het **eigen land van de shop** (`general.address.country`). Bij items waarvan een regel daar de foto's blurt, gaan de afbeeldingen eruit. Per-bezoeker-regels blijven zoals ze waren: de productpagina geeft 404 per land. Landen waar een NO_SHIPPING- of HIDE-regel voor het item geldt, staan niet in `shippingDetails`.
9. **Merchant feed.** Alleen items die nu koopbaar zijn: ACTIVE, met voorraad en met een foto. Uitgesloten zijn ook items met `restrictedSymbols`, `ageRestricted` of `requiresDeactivationCert`, en gevoelige items. Het Shopping-beleid van Google voor wapens en haatsymbolen zou anders tot schorsing van het Merchant Center-account leiden. `condition=used`, `identifier_exists=no`, `brand` = MAKER-facet en `product_type` = categoriepad. Verzendkosten stel je account-breed in Merchant Center in, niet in de feed.
10. **AI-crawlers.** AI-zoekcrawlers en user-fetchers zijn altijd toegestaan. Het gaat om OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User en DuckAssistBot: wie die blokkeert, verdwijnt uit AI-antwoorden. AI-trainingscrawlers (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, meta-externalagent) zijn standaard ook toegestaan. Met de nieuwe instelling **Content → Search engines & AI assistants → "Allow AI training crawlers"** kan de shop ze uitsluiten. Google AI Overviews en AI Mode gebruiken de gewone Googlebot. `Google-Extended` gaat alleen over Gemini-training en grounding, dus uitsluiten kost geen Google-zichtbaarheid.
11. **Blocking metadata voor AI-bots.** `next.config.ts` `htmlLimitedBots` = de standaardlijst van Next plus de AI-crawlers (`src/lib/seo/bots.ts`). Die bots krijgen title, canonical en description in `<head>`, net als Bingbot. Gewone bezoekers houden streaming metadata.
12. **Markdown-alternates.** `/product/{No}.md` en `/{cms-slug}.md` (rewrites in `next.config.ts` → `src/app/md/**`) zijn gelinkt via `<link rel="alternate" type="text/markdown">`. De HTML-pagina blijft canonical (`Link: <…>; rel="canonical"`-header). Voor een verkocht item buiten het archief geldt `X-Robots-Tag: noindex`.
13. **llms.txt.** Wordt geleverd omdat het goedkoop is, maar het is uitdrukkelijk geen ranking-factor (zie §5). Het echte GEO-werk zit in crawlbare HTML, structured data en de markdown-alternates.
14. **`/.well-known/` of `ai.txt`.** Niet gebouwd. Geen grote engine leest deze bestanden. robots.txt is het mechanisme dat OpenAI, Anthropic, Perplexity, Google en Apple documenteren.
15. **Retourbeleid.** Nieuwe instelling `legal.returns`: `days` (standaard 14, het EU-herroepingsrecht; 0 = geen retour) en `fees` (`customer` of `free`). Wordt gebruikt als `MerchantReturnPolicy` op Offer en Organization, met de afleverlanden uit de verzendzones als `applicableCountry`.
16. **Entiteit (NAP).** `OnlineStore` (aanbevolen subtype van Organization voor webshops, [Google](https://developers.google.com/search/docs/appearance/structured-data/organization)) met naam, URL, logo, adres, e-mail, telefoon, contactPoint, `vatID`, KvK als `identifier` (bij NL) en `sameAs`. sameAs komt uit de nieuwe instelling "Official profiles" (alleen https). Het btw- en KvK-nummer zijn toegevoegd aan de publieke settings (ze staan al op facturen).
17. **Platformhost.** De landingspagina en `/apply` zijn nu crawlbaar. `/admin`, `/api/` en `/apply/*` (bedankt- en verifieerpagina's, ook `noindex`) niet. Kleine sitemap en een eigen llms.txt die naar de shops verwijst.
18. **Sitemaps.** Een index op `/sitemap.xml` met `pages`, `categories`, `facets` en `products-N` (10.000 URL's per bestand, afbeeldingen alleen als `image:loc`). Alleen `<lastmod>`: Google negeert `priority` en `changefreq` ([Google](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)). `image:title` en `image:caption` zijn in 2022 afgeschaft. Categorieën en facetten komen er alleen in als ze minstens één te koop staand item tonen.
19. **SearchAction.** Behouden, op verzoek van de eigenaar. Google toont de sitelinks-zoekbalk sinds november 2024 niet meer, maar de markup is onschadelijk.
20. **OG-afbeeldingen.** Product: de 2000w-variant van de hoofdfoto, met de echte afmetingen. Zonder foto's: een gegenereerde kaart (`/og/product/{No}`, next/og). Shoppagina's: de banner, of anders `/og/shop`. `og:type=product` en `product:*`-tags gaan via `metadata.other`, dus als `<meta name>`. Next kent geen OG-type "product", en Facebook leest ook `name=`.

## 3. Wat er gebouwd is

### 3.1 Bestanden

- `src/lib/seo/` (pure modules met tests):
  - `text.ts`: truncatie op woordgrens.
  - `json-ld.ts`: Organization/OnlineStore, WebSite, CollectionPage+ItemList, Product+Offer met shippingDetails en retourbeleid.
  - `metadata.ts`: productbeschrijving, OG-afbeelding en -tags, OG-defaults.
  - `robots.ts` en `bots.ts`.
  - `sitemap-xml.ts`, `merchant-feed.ts`, `llms.ts`.
  - `markdown-alternate.ts` en `shipping-lines.ts`.
  - `validate.ts`: JSON-LD-checks.
- `src/server/seo/`:
  - gecachete data via `shopCache`: `index.ts`, `queries.ts`, `llms.ts`;
  - hostresolutie en responses: `http.ts`;
  - OG-kaart: `og-card.tsx`.
- Routes:
  - `src/app/sitemap.xml/route.ts` (vervangt `src/app/sitemap.ts`) en `src/app/sitemaps/[file]/route.ts`;
  - `src/app/feeds/google-merchant.xml/route.ts`;
  - `src/app/llms.txt`, `src/app/llms-full.txt`;
  - `src/app/md/product/[stockCode]`, `src/app/md/page/[slug]`;
  - `src/app/og/product/[stockCode]`, `src/app/og/shop`.
- Instellingen:
  - `content.seo.{description, allowAiTraining, sameAs}`;
  - `legal.returns.{days, fees}`;
  - de bijbehorende velden in Admin → Settings → Content en Legal & age.
- `scripts/seo/validate-jsonld.ts`: haalt home, /shop, een categorie en een product op van een draaiende shop en controleert de JSON-LD.

### 3.2 Gedeelde bestanden aangepast (afstemming met parallelle agents)

`next.config.ts` (htmlLimitedBots en twee `beforeFiles`-rewrites), `src/proxy.ts` (X-Robots-Tag bij themapreview), `src/app/robots.ts`, `src/app/(shop)/layout.tsx` (alleen `generateMetadata`), `src/app/(shop)/page.tsx`, `shop/page.tsx`, `shop/category/[slug]/page.tsx`, `shop/facet/[facetSlug]/[valueSlug]/page.tsx`, `archive/page.tsx`, `pages/[slug]/page.tsx`, `product/[stockCode]/[[...slug]]/page.tsx`, `apply/thanks` en `apply/verify` (noindex), `src/components/shop/catalog/{CatalogView.tsx (JSON-LD), metadata.ts, _copy.ts}`, `src/components/shop/catalog/product/ProductDetail.tsx` (Suspense om ProvenanceBlock weg), `src/server/storefront/context.ts` (vatNumber en cocNumber publiek), `src/server/storefront/shipping.ts` (`getShopQuoteZones`), `src/server/storefront/content.ts` (ongebruikte sitemap-helper weg), `src/server/settings/schema.ts`, `src/app/admin/(app)/settings/_fields.ts`. Verwijderd: `src/app/sitemap.ts` en `src/components/shop/catalog/product/json-ld.ts`. Die laatste is vervangen door `src/lib/seo/json-ld.ts`.

### 3.3 Titels en beschrijvingen

| Route | Title (de layout voegt " · Shopnaam" toe) | Description |
|---|---|---|
| `/` | `seoTitle` van de HOME-pagina, anders de shopnaam (absoluut) | seoDescription → `content.seo.description` → hero-subtitle → eerste tekstblok → gegenereerd |
| `/shop` | "All items for sale" of "Search: …" (noindex) | Vaste tekst met de shopnaam |
| categorie | seoTitle, anders "{Categorie} for sale" | seoDescription → categorieomschrijving → gegenereerd |
| facet-landing | "{Waarde} ({facet}) — items for sale" | Gegenereerd |
| product | seoTitle, anders de titel (max. 70 tekens) | seoDescription → beschrijving → feitenzin ("Titel — Categorie; WW2, Germany. No. 123, €450.00, for sale at Shop.") |
| CMS | seoTitle, anders de titel | seoDescription → eerste tekstblok → hero-subtitle |
| archief | "Sold archive" | Vaste tekst |

Een description is altijd hooguit 160 tekens en wordt op een woordgrens afgekapt.

### 3.4 Structured data per pagina

- **Home:** `OnlineStore`, `WebSite`+`SearchAction`. Als de home doorstuurt naar de shop, staan beide op `/shop`.
- **Catalogus, categorie, facet en archief:** `BreadcrumbList` en `CollectionPage` → `ItemList` (positie, absolute URL, naam, kaartafbeelding). Alleen op indexeerbare weergaven en zonder gevoelige items.
- **Product:** `Product` met `sku`, `productID` (stock code), `brand` en `manufacturer` (MAKER-facet), `countryOfOrigin` (COUNTRY-facet), `additionalProperty` (facetten en specificaties, plus de staat), `itemCondition: UsedCondition` en afbeeldingen. Daarbij een `Offer` met prijs, valuta, beschikbaarheid, `seller` → `#organization`, `shippingDetails` (per actieve zone met expliciete landen, tarief voor het gewicht van het item, gratis boven de drempel, zonder geblokkeerde landen) en `hasMerchantReturnPolicy`. Verder `BreadcrumbList`.
- **CMS:** `BreadcrumbList`.
- **FAQPage:** op elke CMS-pagina (en de home) met minstens één zichtbaar FAQ-blok. Eén `FAQPage` per pagina, met de vragen van alle FAQ-blokken samen (zie §3.8).

### 3.5 GEO

- Feiten in de HTML: de specificatietabel stond al in de initiële HTML. Herkomst en certificaat staan er nu ook in, zonder Suspense. De data is gecachet, dus dit kost geen extra query.
- Markdown-alternate van een product:
  - vaste volgorde: `# Titel`, dan feiten (No., SKU, Price, Availability, Condition, Category, facetten, specificaties, gewicht, Seller, URL);
  - daarna `## Description`, `## Provenance and authenticity`, `## Shipping and returns` en `## Photos`.
- `/llms.txt` (kort) en `/llms-full.txt` (max. 100 kB):
  - een samenvatting en hoe items beschreven worden (unieke items, No., statussen, herkomst en certificaat-verificatie, markdown-URL-patroon);
  - links naar de catalogus, het archief, de feed en de sitemap;
  - de categorieën, met aantallen;
  - de beleidspagina's, met hun `.md`-variant;
  - in de volledige versie ook subcategorieën met omschrijving, facet-landingspagina's en de nieuwste 48 items.
- Entiteitsconsistentie: één `@id` voor de organisatie, `sameAs` en dezelfde NAP in Organization, llms.txt en markdown.

### 3.6 Coming soon en preview

Met "coming soon" (`getLaunchState().prelaunch`) gebeurt het volgende:
- robots.txt geeft `Disallow: /`;
- `/sitemap.xml` is een lege urlset;
- de sitemapbestanden, de feed, `llms*.txt`, `.md` en `/og/*` geven 404, ook voor staff;
- de layout zet `noindex, nofollow`.

Bij themapreview zet de layout `noindex` en stuurt de proxy de header `X-Robots-Tag: noindex, nofollow`.

### 3.7 Caching

Alle SEO-data loopt via `shopCache`, dat per tenant getagd is:
- **catalog:** producten-pagina's, aantallen, feed-pagina's, categorieën, facetten, omschrijvingen en provenance-vlag;
- **content:** pagina's.

Productlijsten worden per pagina gecachet (2.000 rijen voor de sitemap, 400 rijen met beschrijving voor de feed). Next slaat data-cache-entries van meer dan 2 MB namelijk niet op.

De bestaande `invalidateShopForAction`-mapping dekt alles:
- product, category, facet, compliance en `order.mark_paid`/`cancel` → catalog;
- content → content;
- settings, shipping en domain → tenant.

Een test (`src/server/seo/invalidate.test.ts`) bewaakt dit. Responses krijgen `s-maxage=300` (de `.md` van een product `s-maxage=60`).

Extra kosten per paginaweergave zijn alleen gecachete reads:
- product: de verzendzones en de compliance-regels, beide al gecachet;
- home: de zones.

### 3.8 FAQ-blok en FAQPage

**Wat het is.** Een CMS-blocktype `FAQ` (enumwaarde via migratie `20261008140000_content_block_faq`; de data staat zoals bij elk blok als JSON in `content_blocks.data`). Velden: een optionele titel en 1–30 items `{ question (≤ 200 tekens), answer (Markdown, ≤ 2000 tekens) }`. Lege vragen of antwoorden en dubbele vragen (hoofdletter- en spatie-ongevoelig) worden geweigerd, zowel in de editor als in de service (`src/server/content/blocks.ts`).

**Admin.** Website → Pages → blok "FAQ" (groep Text). De editor heeft per item een vraagveld en een Markdown-antwoord, met knoppen om items toe te voegen, te verwijderen en omhoog/omlaag te schuiven (`BlockFields.tsx`, `FaqField`). De preview toont de vragen met het eerste antwoord open.

**Storefront.** `FaqBlock` in `src/components/shop/blocks/TextBlocks.tsx`: een accordeon met native `<details>`/`<summary>`. Geen client-JS; toetsenbord en schermlezer werken standaard; items gaan onafhankelijk van elkaar open. Alle antwoorden staan in de initiële HTML, ook dichtgeklapt, dus crawlers en AI-fetchers zonder JS lezen ze. Elk item heeft een anker `#faq-{blokId}-{n}`. Styling alleen met `--shop-*`-tokens (lijnen, ink, muted, primary bij hover), dus alle vier themapresets werken.

**Structured data.** `BlockRenderer` verzamelt de items van alle zichtbare FAQ-blokken en zet precies één `FAQPage` op de pagina (`faqPageJsonLd` in `src/lib/seo/json-ld.ts`). Dubbele vragen komen er één keer in. Het antwoord gaat als `Answer.text` mee: een simpele alinea als platte tekst, anders als HTML met alleen de tags die Google toestaat (p, ul/ol/li, a, strong, em, br, h2–h4). Blockquote en hr uit onze Markdown-subset gaan eruit en relatieve links worden absoluut. `validate.ts` controleert FAQPage (Question met name en `acceptedAnswer.text`).

**Wat Google ermee doet.** Sinds augustus 2023 toont Google FAQ rich results alleen nog voor bekende, gezaghebbende overheids- en gezondheidssites ([Google: FAQPage](https://developers.google.com/search/docs/appearance/structured-data/faqpage)). Een militariawinkel krijgt dus vrijwel zeker geen uitklapbare FAQ in de zoekresultaten. De markup is wel geldig en schaadt niet. Ze geeft Google, Bing en AI-assistenten de vraag-antwoordparen expliciet, en de inhoud zelf (korte, feitelijke antwoorden in de HTML) is wat AI-antwoorden citeren. Volg de richtlijnen van Google:
- alleen FAQ's die de shop zelf schrijft (geen vragen van bezoekers; daarvoor bestaat `QAPage`);
- de volledige vraag en het volledige antwoord staan zichtbaar op de pagina (een dichtgeklapt `<details>` telt als zichtbaar);
- geen reclame;
- staat dezelfde vraag op meerdere pagina's, markeer dan maar één exemplaar. Zet een FAQ-blok dus niet met dezelfde vragen op meerdere pagina's.

**Markdown-alternate.** `/{slug}.md` neemt FAQ-blokken mee: met een bloktitel `## Titel` en per vraag `### Vraag`, zonder titel `## Vraag`, met het antwoord eronder. `llms.txt` en `llms-full.txt` renderen geen blokken (alleen links naar beleidspagina's), dus daar verandert niets; de FAQ-pagina is via de sitemap en de `.md`-variant vindbaar.

**Demo.** `scripts/seed-demo.ts` maakt voor concept-militaria een gepubliceerde pagina `/faq` ("Frequently asked questions": een korte intro plus een FAQ-blok met 11 vragen) en zet "FAQ" in het footermenu onder Service. Idempotent; opnieuw toepassen met `npm run db:seed:demo -- --content-only`.

## 4. Validatie (2026-10-08, lokaal)

- `npx tsc --noEmit`, `npx eslint` (0 errors), `npx vitest run` (88 bestanden, 899 tests), `npm run test:integration` (47 bestanden, 379 tests) en `npm run e2e` (12 tests, waarvan 4 nieuwe in `e2e/seo.spec.ts`) zijn groen.
- `npx tsx scripts/seo/validate-jsonld.ts`: home (OnlineStore, WebSite), /shop en een categorie (BreadcrumbList, CollectionPage) en een product (Product, BreadcrumbList) zijn allemaal zonder fouten. De canonical staat in `<head>` voor de ClaudeBot-UA.
- Lighthouse, categorie SEO, op de dev-server (`concept.localhost:3000`): `/`, `/shop`, `/shop/category/helmets`, een productpagina en `/about` scoren allemaal **100**. Een productie-build op :3001 is niet gedraaid: de performance-agent gebruikte die build/server tegelijk, en een rebuild van `.next` zou die server breken. SEO-audits zijn structureel, dus dev is representatief. Performance hoort bij de perf-agent.
- Nog te doen na deploy op een echte host: Google Rich Results Test en de Schema Markup Validator op een productpagina, de sitemap-index indienen in Search Console en de feed als geplande fetch in Merchant Center zetten.

## 5. Wat engines echt lezen (bronnen)

- **Google** (Search, AI Overviews, AI Mode): de gewone Googlebot-crawl, structured data en dezelfde SEO-basis. Er is geen speciale AI-markup ([AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)). `Google-Extended` regelt alleen Gemini-training en grounding, niet Search ([Google crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)). Merchant listings en Product snippets: [merchant listing](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing), [Organization (OnlineStore, hasMerchantReturnPolicy)](https://developers.google.com/search/docs/appearance/structured-data/organization), [productfeed-specificatie](https://support.google.com/merchants/answer/7052112).
- **OpenAI**: `OAI-SearchBot` (ChatGPT-zoekindex), `ChatGPT-User` (ophalen op verzoek van een gebruiker) en `GPTBot` (training); elk apart te sturen via robots.txt ([OpenAI bots](https://developers.openai.com/api/docs/bots)).
- **Anthropic**: `ClaudeBot` (training), `Claude-User` (ophalen op verzoek van een gebruiker) en `Claude-SearchBot` (zoekkwaliteit) ([Anthropic support](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)).
- **Perplexity**: `PerplexityBot` (index, volgens Perplexity niet voor training) en `Perplexity-User` ([Perplexity bots](https://docs.perplexity.ai/guides/bots)).
- **Apple**: `Applebot` (Siri/Spotlight-zoeken) en de token `Applebot-Extended` (training) ([Apple](https://support.apple.com/en-us/119829)).
- **llms.txt**: een voorstel ([llmstxt.org](https://llmstxt.org)). Geen grote zoek- of AI-dienst heeft bevestigd dat ze het bestand gebruiken voor ranking of citatie. Google heeft publiek gezegd het niet te gebruiken. We leveren het omdat het weinig kost, niet omdat het iets oplevert.
- **JavaScript**: veel AI-fetchers voeren geen JS uit. Daarom horen alle kernfeiten in de server-HTML, staat metadata blocking in `<head>` voor deze bots en zijn er de markdown-alternates.

## 6. Checklist

- [x] Unieke, ingekorte titels en beschrijvingen per indexeerbare route
- [x] Canonicals zonder filter-, sort- of paging-ruis; self-canonical paginering; facetfilter → landingspagina
- [x] `noindex` op zoeken, mandje, checkout, account, wishlist, order-, alert-, offer- en verify-pagina's, apply-bevestigingen, filtervarianten, coming soon en themapreview (statische test: `src/lib/seo/private-routes.test.ts`)
- [x] JSON-LD: OnlineStore, WebSite+SearchAction, BreadcrumbList, Product+Offer (shipping en returns), CollectionPage/ItemList
- [x] Sitemap-index met lastmod en image-entries; gevoelige en compliance-verborgen items eruit
- [x] robots.txt per host; AI-zoekbots toegestaan; opt-out voor AI-training in de instellingen
- [x] OG/Twitter: productfoto of gegenereerde kaart, `og:type=product`, `product:price:*`
- [x] Eén h1 per pagina, `lang="en"`, alt-teksten (titel als fallback), geen hreflang
- [x] Google Merchant-feed op `/feeds/google-merchant.xml`
- [x] `/llms.txt`, `/llms-full.txt` en markdown-alternates voor producten en CMS-pagina's
- [x] Herkomst in de initiële HTML
- [x] FAQ-blok met één `FAQPage` per pagina (zie §3.8)
- [x] Tests: unit (builders), integratie (tenant-isolatie, zichtbaarheid, coming soon) en e2e (canonical en JSON-LD)
- [ ] Na de eerste productiedeploy: Rich Results Test, Search Console (sitemap) en Merchant Center (feed, account-brede verzendkosten en retourbeleid)

## 7. Aanbevelingen (nog niet gebouwd)

1. ~~**Echte FAQ-content.**~~ Gebouwd (2026-10-08): blocktype `FAQ` met `FAQPage`-markup, zie §3.8.
2. **Afmetingen en gewicht als gestructureerde velden.** Nu staat dit in vrije specificaties. Met aparte velden kan het naar `width`/`height`/`depth`/`weight` in JSON-LD en naar `g:product_*` in de feed.
3. **Productie-Lighthouse.** Zodra de perf-agent klaar is, `next build && next start -p 3001` draaien en `scripts/perf/lighthouse.ts` met de SEO-categorie.
4. **OpenAI-productfeed** (ChatGPT shopping / agentic commerce). Dit vergt aanmelding als merchant. De Merchant-feed is een goede basis om het formaat uit af te leiden.
5. ~~**Opschonen.**~~ Gedaan: `listProductsForSitemap` is weg uit `src/server/storefront/products.ts`, samen met het testgedeelte in `storefront.int.test.ts` (het enige gebruik). De sitemap-zichtbaarheid wordt getest in `tests/integration/seo.int.test.ts`.
6. **Meertaligheid.** Bij een NL/DE-versie hreflang toevoegen, plus `inLanguage` in de JSON-LD en een `/llms.txt` per taal.
