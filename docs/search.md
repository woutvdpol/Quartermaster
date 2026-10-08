# Slim zoeken

Zoeken in de shop begrijpt gewone taal ("Duitse helm WW2 onder 500 euro", "feldbluse met kraagspiegels"),
vindt items op betekenis en op foto ("lijkt hierop"), en blijft snel. Alles draait lokaal: geen externe
AI-dienst, geen LLM. Code: `src/server/search` (app), `src/embedder` (modelservice).

## Inhoud

1. [Architectuur](#1-architectuur)
2. [Modellen en licenties](#2-modellen-en-licenties)
3. [Zoekopdracht begrijpen (parser)](#3-zoekopdracht-begrijpen-parser)
4. [Synoniemen](#4-synoniemen)
5. [Ranking](#5-ranking)
6. [Zichtbaarheid en tenant-isolatie](#6-zichtbaarheid-en-tenant-isolatie)
7. [API voor de UI](#7-api-voor-de-ui)
8. [Indexeren](#8-indexeren)
9. [Prestaties](#9-prestaties)
10. [Geheugen](#10-geheugen)
11. [Ops](#11-ops)
12. [Afwijkingen van het ontwerp en open punten](#12-afwijkingen-van-het-ontwerp-en-open-punten)

---

## 1. Architectuur

```
 browser ──/shop?q=  /api/search/suggest  /api/search/image──▶ web (Next.js)
                                                                │  parser (deterministisch, ~0,1 ms)
                                                                │  lexicaal: Postgres FTS + pg_trgm
                                                                │  vectoren: pgvector (HNSW, cosine)
                                                                │  query-embeddings: HTTP, 150 ms time-out, LRU-cache
                                                                ▼
                                                     embedder (eigen container) ◀── worker (indexeren, HTTP, retries)
                                                     e5-small + SigLIP 2, micro-batching
```

Per zoekopdracht (per tenant):

1. **Parser** haalt facetfilters (land, periode, onderdeel, eenheid, type), prijzen, status ("verkocht"),
   sortering ("goedkoop") en voorraadnummers uit de tekst; de rest is vrije tekst. Elk begrepen stuk
   wordt een verwijderbare chip.
2. **Drie retrievers** parallel, allemaal met exact dezelfde WHERE als de catalogus (§6):
   - **lexicaal** — full-text search op `products.searchVector` (gegenereerde kolom, config `qm_search`
     = `simple` + `unaccent`, titel/SKU gewicht A, beschrijving C), prefix-termen + synoniemgroepen;
     bij < 10 treffers aangevuld met pg_trgm-woordgelijkenis op de titel (typo's: "stahlhem" → Stahlhelm);
   - **semantisch** — e5-query-vector tegen de tekst-embeddings (HNSW);
   - **fotoruimte** — SigLIP-tekstvector tegen de foto-embeddings (HNSW), alleen als versterking (§5).
3. **Fusie** met Reciprocal Rank Fusion; exacte voorraadnummer/SKU-treffers vast bovenaan.
4. Bij **nul resultaten** met begrepen facetten: facetfilters vervallen, hun woorden worden gewone
   zoektekst (`interpretation.relaxed = true`, de UI kan "geen exacte treffers" tonen).

**Modellen draaien in een eigen container** (besluit eigenaar): `src/embedder/server.ts` — kleine HTTP-server
(Node 24 draait de TypeScript direct, geen build), laadt beide modellen bij de start, micro-batching per
model, wachtrijlimiet, alleen intern bereikbaar met `EMBEDDER_TOKEN`. Web en worker zijn clients
(`src/server/search/http-embedder.ts`). Valt de embedder uit of is hij traag, dan zoekt web lexicaal +
facetten verder (§11); de shop blijft werken.

## 2. Modellen en licenties

| Rol | Model | Formaat | Dim | Licentie |
|---|---|---|---|---|
| Tekst (query ↔ product) | `Xenova/multilingual-e5-small` (ONNX-export van intfloat/multilingual-e5-small) | int8, 118 MB | 384 | MIT |
| Foto's + tekst→foto | `onnx-community/siglip2-base-patch16-224-ONNX` (google/siglip2-base-patch16-224) | int8, tekst 283 MB + visie 95 MB | 768 | Apache-2.0 |
| Runtime | `@huggingface/transformers` 4.3 (transformers.js) + onnxruntime-node 1.30, CPU | | | Apache-2.0 / MIT |

e5 gebruikt de voorvoegsels `query: ` en `passage: `. **SigLIP 2 in plaats van CLIP ViT-B/32** (afwijking, §12):
CLIP's tekstencoder is Engels-only — "duitse helm", "verrekijker" of "kompas" gaven bij CLIP willekeurige
foto's, SigLIP 2 (meertalig getraind) vond helmen, de verrekijker en het kompas. Eén model voor productfoto's,
geüploade foto's én tekst→foto. Gemeten op de demo-foto's: CLIP visie 23 ms/foto, SigLIP 2 57 ms/foto
(p50, M-serie Mac); voor foto-zoeken prima. Multilingual CLIP (`clip-ViT-B-32-multilingual-v1`) is alleen als
platformspecifieke ONNX-int8 beschikbaar (arm64/avx2-varianten) en is daarom afgevallen.

Modellen staan niet in een image of in git: ze worden eenmalig gedownload naar `MODEL_CACHE_DIR`
(lokaal `.local/models`, Docker/k8s een volume op `/models`), ~650 MB.

## 3. Zoekopdracht begrijpen (parser)

`src/server/search/parser.ts` — puur, deterministisch, unit-getest (`parser.test.ts`, NL/DE/EN).

| Herkend | Voorbeelden | Resultaat |
|---|---|---|
| Facetwaarden (namen + slugs van de shop, en synoniemen) | "Duitse", "deutscher", "German", "WO II", "Tweede Wereldoorlog", "2. Weltkrieg", "koude oorlog", "fallschirmjäger" | filter `country.germany`, `period.ww2`, … |
| Type-woorden | "helm", "Stahlhelm", "uniform" | filter `type.helmets` **én** blijven zoektekst (het woord rankt nog steeds) |
| Prijzen | "onder 500", "onder € 500,-", "unter 1.500 Euro", "max 300", "tot 300 euro", "boven 1000", "vanaf 200 euro", "tussen 100 en 500", "100-500 euro", "€100 - €500", "zwischen … und …" | `min`/`max` (hele valuta-eenheden, zoals de URL-parameters) |
| Jaartallen ≠ prijs | "tot 1945", "vanaf 1939", "iron cross 1914", "1939-1945" | blijven tekst (of periode via synoniem) |
| Voorraadnummer | "#50212", "nr 50212", "no. 50212"; een kaal getal van 5–9 cijfers | exacte treffer bovenaan |
| Status | "verkocht", "sold", "verkauft" | zoekt in het archief (verkochte items); "beschikbaar"/"op voorraad" wordt genegeerd (standaard) |
| Sortering | "goedkoop", "cheapest", "günstig" / "duur", "teuer" | `price_asc` / `price_desc` (als de bezoeker zelf geen sortering koos) |

Langste frase wint (max. 5 woorden), hoofdletters/accenten tellen niet (`fold`: Feldmütze = feldmutze).
Stopwoorden (NL/DE/EN/FR, plus "origineel"/"original") worden uit de zoektekst gehaald.

Elke chip: `{ kind, label, matched, token?, removeQuery }`. `removeQuery` is de zoekopdracht zonder die
woorden — "chip verwijderen" = navigeren naar `/shop?q=<removeQuery>` (behoud overige parameters).
Labels zijn Engels (UI-taal), bijvoorbeeld "Country: Germany", "Max €500", "Sold items", "No. 50212".

## 4. Synoniemen

Instelling **Settings → Catalog → Search synonyms** (`catalog.searchSynonyms`), één regel per item:

```
Germany: duits, duitse, deutsch, german, wehrmacht
veldfles: canteen, feldflasche, water bottle
```

- Is het woord vóór de dubbele punt de **naam (of slug) van een facetwaarde** van deze shop, dan selecteren de
  aliassen dat filter ("duitse helm" → Country: Germany). Bestaat die waarde in een shop niet, dan werkt de
  regel automatisch als woordgroep — dezelfde standaardlijst past dus bij elke shop.
- Anders is het een **woordgroep**: gelijkwaardige woorden voor het exacte zoeken. Synoniemen matchen alleen in
  **titels** (gewicht A), niet in beschrijvingen ("photo" zou anders elke "zie foto's"-tekst raken), en ranken
  lager dan het getypte woord. Ze gaan ook mee naar de taalmodellen ("veldfles (canteen, feldflasche, water bottle)"):
  een los buitenlands woord is voor een klein model dubbelzinnig, met synoniemen niet.
- Standaardlijst: `DEFAULT_SYNONYMS` in `src/server/search/synonyms.ts` — landen, periodes, onderdelen, eenheden,
  types en ~35 militaria-woordgroepen (helm/Stahlhelm/casque, koppelslot/Koppelschloss/buckle, kraagspiegels/
  Kragenspiegel/collar tabs, Soldbuch/paybook, …) in NL/DE/EN.
- Een eigenaar die de lijst aanpast, krijgt latere verbeteringen van de standaardlijst niet automatisch (zijn
  versie is opgeslagen). Wijzigingen werken binnen 30 s (cache per proces; direct in het proces dat opsloeg).

## 5. Ranking

Parameters in `src/server/search/ranking.ts` (unit-getest), gekalibreerd op de demo-shop.

- **Lexicaal**: score = 2 × `ts_rank`(getypte woorden) + `ts_rank`(woorden + synoniemen) + 1 als alle woorden
  voorkomen. Hoogstens 1.500 treffers worden gerankt (suggest: 300) — zie §9.
- **Semantisch (e5)**: cosines van korte productteksten liggen dicht op elkaar (ongerelateerd ≈ 0,77–0,80,
  gerelateerd 0,80–0,89). Zonder lexicale treffers: houd hits ≥ 0,81 en binnen 0,025 van de beste. Mét lexicale
  treffers mogen alleen duidelijke uitschieters (z-score ≥ 2,5 binnen de kandidaten) er zelfstandig bij;
  lexicale treffers krijgen de semantische rang als versterking.
- **Fotoruimte (SigLIP-tekst → foto)**: cosines zijn klein (ruis ≈ 0,06 ± 0,005, duidelijke match 0,075+) en
  schuiven met de lengte van de query. Alleen items die tekst al vond krijgen een boost (z ≥ 0,5); vreemde items
  komen er alleen bij als tekst niets vond én ze een uitschieter zijn (z ≥ 2,5). De tekstencoder van SigLIP is
  gevoelig voor typo's ("stahlhem" → een medaillefoto); daarom nooit zelfstandig naast tekst-treffers.
- **Fusie**: RRF met k = 20 (lijsten zijn kort; de topposities moeten tellen), gewichten lexicaal 1,0,
  semantisch 0,9, fotoruimte 0,5. Exacte voorraadnummer/SKU-treffers vooraan.
- **Sortering**: standaard "Best match" (relevantie) zolang er `q` is; prijs/nieuw/… sorteren de gevonden set.
  Blijft er geen vrije tekst over ("Duits WO2"), dan is het een gefilterde lijst in de standaardvolgorde van de shop.
- **Foto-zoeken**: SigLIP foto ↔ foto, hits ≥ 0,7 en binnen 0,1 van de beste (zelfde soort object ≈ 0,93–0,99,
  andere objecten met dezelfde fotostijl 0,85–0,9). Met tekst erbij gelden de filters uit die tekst en rankt de
  tekst mee (gewicht 0,6) binnen de visuele treffers.
- **Lijkt hierop**: buren op foto én tekst van het product; per lijst z-scores, opgeteld ≥ 1,5. Liever niets
  dan ruis (de buren-cosines zijn dicht: 0,85–0,92 voor alles wat op dezelfde manier gefotografeerd is).

Demo-shop (80 items, echte modellen) — top-resultaten (te koop):

| Zoekopdracht | Begrepen | Resultaat |
|---|---|---|
| duitse helm | Country: Germany, Type: Helmets | Stahlhelm M40 Heer; Bundeswehr M56 Stahlhelm (de andere Duitse helmen zijn verkocht) |
| feldbluse | — | Feldbluse M36; British Battledress blouse; KNIL field jacket |
| feldbluse met kraagspiegels | — | Feldbluse M36; Battledress blouse; KNIL field jacket |
| pegasus patch | — | geen (de Pegasus-patch is een concept: niet zichtbaar ✔) |
| iron cross 1914 | — | Iron Cross 2nd class 1914; Cross for Justice and Freedom |
| jas uit de koude oorlog | Period: Cold War → versoepeld | geen jas uit de Koude Oorlog te koop (DT-63 is verkocht); daarom versoepeld: KNIL jacket, Feldbluse, Battledress blouse |
| stahlhem (typo) | — | Stahlhelm M40; Bundeswehr M56 Stahlhelm |
| Duitse helm WW2 onder 500 euro | Max €500 (+ versoepeld) | geen Duitse WO2-helm < €500 → helmen < €500: Dutch M53, Dutch M27, Bundeswehr M56, Brodie |
| verrekijker / veldfles / bajonet / riemgesp | — | Dienstglas 6x30 / Dutch water bottle / Seitengewehr 84/98 / Belt buckle Heer |
| goedkope helm | Lowest price first, Type: Helmets | 6 helmen van €45 tot €1.450 |
| verkochte helmen | Sold items, Type: Helmets | archief: Belgian Mle 1931, US M1, Soviet SSh-40, … |
| foto van de M40-helm | — | M40, Bundeswehr M56, Dutch M53, Dutch M34, Brodie, Dutch M27, daarna petten |
| lijkt hierop: Iron Cross 1914 | — | Infantry Assault Badge, Cross for Justice and Freedom, Mantel M40 |

Zwakke plekken (demo): "medaille" vindt de Cross for Justice maar ook "Dutch M27 helmet with lion badge"
(e5-small koppelt badge/medaille); de demoteksten zijn sjablonen met dezelfde boilerplate — echte
beschrijvingen geven het semantische model meer houvast.

## 6. Zichtbaarheid en tenant-isolatie

Alle retrievers krijgen de WHERE-clausule van de catalogus zelf (`whereSql` uit
`src/server/storefront-catalog/queries.ts`, met `q = null`): tenant, zichtbaarheid (te koop/gereserveerd, of
verkocht voor het archief; nooit concept, gearchiveerd of gestolen), landenregels (HIDE_PRODUCT op basis van het
land van de bezoeker), categoriebereik, facet-, tag- en prijsfilters. Vectorqueries filteren daarnaast op
`product_embeddings.tenantId`. Gevoelige items ("blur voor gasten") en landen-blur worden net als in de catalogus
als vergrendelde kaart getoond, zonder echte afbeeldings-URL (`toPublicCards`). "Binnenkort open"-shops: de
API-routes antwoorden 404 voor bezoekers (`getOpenShopTenant`). Integratietests: `src/server/search/search.int.test.ts`.

## 7. API voor de UI

Serverfuncties (`import { … } from "@/server/search"`):

| Functie | Gebruik |
|---|---|
| `searchProducts(tenantId, { q, filters?, sort?, fallbackSort?, page?, pageSize?, show?, scope?, currency?, interpret?, facets?, explain? })` | → `{ items: CatalogCard[], total, page, pageSize, sort, mode, interpretation, facets: CatalogFacets, timing }`. `interpretation.chips` voor "begrepen als"-chips, `relaxed` als de filters versoepeld zijn. `timing.semantic`/`imageText`: `used` / `cold` (embedder weg of traag) / `off` / `skipped`. |
| `suggest(tenantId, q, { scope?, currency?, limit? })` | → `{ query, interpretation, facets: FacetSuggestion[], products: CatalogCard[] (≤ 5), timing }` |
| `searchByImage(tenantId, rgb, { q?, filters?, page?, scope?, currency? })` | → zelfde vorm als `searchProducts` (zonder facetten). Eerst `decodeSearchImage(bytes)`. Gooit `SearchUnavailableError` (geen embedder) en `SearchImageError` (te groot/ongeldig). |
| `similarProducts(tenantId, productId, { limit?, scope? })` | → `CatalogCard[]` (leeg als niets duidelijk lijkt) |
| `searchRequestContext()` / `toPublicCards(ctx, cards)` | shop, scope (landenregels) en kaartmapping (reserveringen, blur) voor route handlers |

Route handlers (contracten in `src/server/search/api-types.ts`, client-veilig te importeren):

- `GET /api/search/suggest?q=…` → `SuggestResponse`: `facets[]` met `href` (filter-URL), `products[]` als
  `ProductCardData` (zelfde lock/blur-regels als het grid), `searchHref` (`/shop?q=…`), `timing`. Minimaal 2 tekens.
  `Cache-Control: private, no-store`; throttle 30 requests / 10 s per IP (in-memory, per pod).
- `POST /api/search/image` (multipart: `file` JPEG/PNG/WebP ≤ 10 MB, optioneel `q`, `f`, `min`, `max`, `page`)
  → `ImageSearchResponse` of `{ error, message }` (403 cross-origin, 411 zonder lengte, 413 te groot,
  415/422 ongeldig, 429 rate limit, 503 embedder niet beschikbaar). Same-origin; atomische rate limit (`take`) per
  IP (20 / 10 min) en per shop (600 / 10 min). De foto wordt alleen in geheugen verwerkt (verkleind tot 224×224 RGB
  en weggegooid), nooit opgeslagen of gelogd.

`/shop?q=` (en categorie/archief met `q`) gebruikt de engine al (`CatalogView`); URL's, facetten, paginering en
`noindex` blijven zoals ze waren. Nieuw: sorteeroptie `relevance` ("Best match", standaard bij een zoekopdracht).
De chips, de dropdown in de header en de fotoknop bouwt de UI.

## 8. Indexeren

- Tabel `product_embeddings` (pgvector): per product een `text`-vector (e5, 384) en een `image`-vector (SigLIP, 768)
  met `model`, `dim`, `contentHash` (sha256 van model + invoer). Ongewijzigde producten worden niet opnieuw
  ge-embed. HNSW-indexen (cosine) zijn partiële expressie-indexen per soort (`embedding::vector(384)` /
  `::vector(768)`, migratie `20261008160000_smart_search`).
- Tekst-invoer: titel, categoriepad, facetwaarden ("Country: Germany"), tags, SKU, specificaties, begin van de
  beschrijving (Markdown gestript). Foto: de hoofdfoto (eerste op volgorde), de 800w-variant, in de worker
  verkleind tot 224×224 zodat alleen pixels naar de embedder gaan.
- Alle producten worden geïndexeerd (ook concepten: direct vindbaar bij publiceren); zichtbaarheid wordt bij het
  zoeken toegepast.
- **Wanneer**: `audit()` (elke admin-mutatie) zet `search.embed-product` klaar (5 s debounce, één per product
  wachtend + één actief); taxonomie-wijzigingen (facet/categorie/tag hernoemd, samengevoegd, import klaar) zetten
  `search.reindex-tenant` klaar (60 s debounce). Cron `search.sync` (elke 10 min) vangt de rest (imports, ETL, SQL).
- **Handmatig**: Settings → Catalog → kaart "Search index" toont dekking ("80 of 80 products indexed · 78 of 78
  photos") en heeft **Rebuild search index** (alleen gewijzigde) en **Re-embed everything** (na een modelwissel),
  met voortgang. CLI: `npm run search -- reindex <shop-slug>|--all [--force]`, `npm run search -- status <slug>`.
- Doorvoer (demo, via HTTP): 80 producten met 78 foto's in 6 s ≈ 75 ms per product (foto's opeenvolgend).

## 9. Prestaties

Servertijd, gemeten met `npm run search -- bench <slug>` (in-process serverfuncties, echte modellen via de
embedder over HTTP, Postgres 18 + pgvector 0.8 lokaal in Docker, M-serie Mac). **Let op**: de machine had tijdens
de metingen een load average van 5–48 (andere processen); getallen zijn eerder te hoog dan te laag.

| | demo (80 items) p50 / p95 | synthetisch 50k p50 / p95 |
|---|---|---|
| suggest (prefixen van 15 queries) | 5,8 / 17 ms | 17,8 / 50,6 ms |
| searchProducts, query-embedding gecachet, zonder facetten | 5,9 / 30 ms | 21 / 70 ms |
| searchProducts + facettellingen | 35 / 60 ms | 39 / 85 ms |
| searchProducts, query-embedding niet gecachet (e5 + SigLIP-tekst via HTTP) | 45 / 87 ms | 39 / 104 ms |
| searchByImage (decoderen + embedden + kNN) | 68 / 84 ms | 73 / 95 ms |

- Embedder los (curl, inclusief HTTP): e5-query ≈ 7 ms, SigLIP-tekst ≈ 20 ms, foto ≈ 50–70 ms. Gemiddeld
  25–45 ms per call vanuit de app onder gelijktijdige last (twee modellen tegelijk delen de CPU).
- Via HTTP op de productieserver (`next start`): `/api/search/suggest` 8–30 ms, `/shop?q=…` 23–35 ms (warm),
  `/api/search/image` 73–165 ms.
- Synthetisch 50k: `scripts/perf/search-50k.sql` kloont de 80 demo-items 625× (70 % te koop, 25 % verkocht,
  5 % concept) met hun facetten en embeddings (+ ruis) in een scratch-database (zoals docs/perf/baseline.md).
- Twee optimalisaties kwamen uit die meting:
  1. FTS en trigram **niet** in één OR-query: de trigram-recheck (`word_similarity`) op ~8.000 kandidaten kostte
     150 ms voor "helm"; nu eerst FTS (5–20 ms) en trigram alleen als FTS < 10 treffers geeft (typo's).
  2. Ranken is het dure deel ("jas" = ~6.000 jassen in de 50k-shop, 100 ms): hoogstens 1.500 treffers worden
     gerankt (suggest 300). suggest p95 ging van 190 → 51 ms.
- Query-embeddings worden per proces gecachet (LRU, 1.000 stuks, 10 min).
- Paginarender wacht nooit op een model: de embedder-client heeft 150 ms time-out voor queries; bij uitval
  15 s "circuit open" en lexicaal zoeken.

## 10. Geheugen

Gemeten in de embedder (RSS):

| Moment | RSS |
|---|---|
| leeg proces | 90 MB |
| + e5-small (incl. tokenizer met 250k tokens: ~180 MB JS-heap) | ~780 MB |
| + SigLIP 2 tekstencoder | ~1,23 GB |
| + SigLIP 2 visie | ~1,31 GB (piek na laden) |
| stabiel na gebruik | 0,76–1,2 GB (Docker: 1,21 GiB) |

Daarom de eigen container: web en worker blijven ~300–400 MB. k8s: request 1,5 Gi / limit 2 Gi, CPU 500m–2,
`SEARCH_MODEL_THREADS=2`. Laden van schijf: e5 0,7 s, SigLIP-tekst 0,9 s, visie 0,2 s (container op Docker
Desktop: 6 / 14 / 26 s inclusief eerste download). Image `quartermaster-embedder` ≈ 510 MB zonder modellen.

## 11. Ops

- **Lokaal**: `npm run embedder` (model-download bij eerste start naar `.local/models`; zet `EMBEDDER_TOKEN`
  of `EMBEDDER_ALLOW_NO_TOKEN=1`) of `docker compose up -d embedder`; in `.env` `EMBEDDER_URL` +
  `EMBEDDER_TOKEN` (zie `.env.example`). Zonder embedder werkt `npm run dev` gewoon (lexicaal + facetten).
  Vooraf downloaden: `npm run models:fetch`.
- **Kubernetes**: zie docs/deploy.md § 11b (Deployment + PVC + initContainer, NetworkPolicy, probes).
- **Gezondheid**: embedder `GET /health` (proces leeft) en `GET /ready` (alle modellen geladen, met RSS);
  web `GET /api/ready` → `search: { embedCalls, embedMsAvg, timeouts, errors, lexicalFallbacks }` per pod.
  Logregels: `[search] embedder unavailable (…)` (één keer per uitval) en `[search] embedder available again`.
- **Herindexeren**: admin-knop of `npm run search -- reindex <slug>`; na een **modelwissel** (andere `key` in
  `src/embedder/contract.ts`) "Re-embed everything". Een model met een **andere dimensie** vraagt een migratie
  (nieuwe partiële HNSW-index met de nieuwe `vector(n)`-cast) en aanpassing van de casts in `retrieval.ts`.
- **Postgres**: pgvector vereist (dev/CI: image `pgvector/pgvector:pg18`; managed: extensie inschakelen, deploy.md
  § 12). De dev-container is omgezet van `postgres:18-alpine` naar `pgvector/pgvector:pg18` met behoud van het
  volume: eerst `pg_dumpall` naar `.local/backups/`, daarna `REINDEX DATABASE` op alle databases (musl en glibc
  sorteren tekst anders: na de wissel stond de volgorde van tabellen in de telling al anders), rijtellingen van
  alle tabellen vóór/na identiek, `amcheck` (`bt_index_check` met heapallindexed) op alle 218 btree-indexen OK.
  Andere ontwikkelaars met een bestaand alpine-volume: zelfde procedure (`docker compose up -d postgres`, dan
  `REINDEX DATABASE` per database).
- **Kosten bij schaal**: indexeren ≈ 75 ms per product met foto (opeenvolgend) → 50k producten ≈ 1 uur eenmalig;
  wijzigingen daarna per product.

## 12. Afwijkingen van het ontwerp en open punten

Afwijkingen (bewust):

1. **SigLIP 2 i.p.v. CLIP ViT-B/32** — meertalig (§2). Groter (tekst 283 MB) maar één model voor alles.
2. **Modellen in een eigen container** (besluit eigenaar, na het eerste ontwerp): niet in web/worker.
3. **tsvector-kolom zonder categorie/facetnamen**: een gegenereerde kolom kan geen andere tabellen lezen. Facetnamen
   worden door de parser filters, en zitten in de tekst-embedding; categorienamen alleen in de embedding.
4. **`simple`-config + prefix + trigram i.p.v. stemming** (titels mengen NL/DE/EN en eigennamen).
5. **Facettellingen** bij een zoekopdracht worden geteld over de kandidaten zónder facetfilters (OR-binnen-facet
   blijft kloppen) — met de retriever-limieten is dat een benadering voor zeer brede zoekopdrachten in grote shops.
6. **Suggest-throttle in geheugen** (per pod) i.p.v. de DB-limiter: een DB-ronde per toetsaanslag kost meer dan de
   zoekopdracht zelf. Foto-zoeken gebruikt wél de atomische `take`.
7. **Fotoruimte-lijst alleen als versterking** van tekst-treffers (§5), behalve als tekst niets vindt.

Open punten:

- Kalibratie gebeurde op demo-sjabloonteksten en getekende demo-foto's; herijken (`npm run search -- query <slug>
  "<q>" --explain` toont per retriever de scores) zodra er echte shopdata is.
- Indexeren van foto's kan parallel/batchgewijs (embedder ondersteunt batches van 8) — nu opeenvolgend.
- Worker-/migrate-image bevat nog `onnxruntime-node` en `@huggingface/transformers` (gedeelde dependencies, ~300 MB incl. binaries voor andere OS'en); ze worden daar niet geladen. Opschonen kan met een aparte prune-stap.
- Synoniemen per taal/shop verder uitbreiden met de eigenaar; aangepaste lijsten krijgen nieuwe standaardregels
  niet automatisch.
- Zoekstatistieken (zoekopdrachten zonder resultaat) bestaan nog niet; nuttig om synoniemen te verbeteren.
