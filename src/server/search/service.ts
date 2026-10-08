import "server-only";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { getCatalogFacets, loadCards, orderSql, whereSql, type CatalogMode, type ListScope } from "@/server/storefront-catalog/queries";
import { resolveFacetSelection, tokensForValueIds } from "@/server/storefront-catalog/facet-selection";
import { PAGE_SIZE, MAX_SHOW, facetToken, type CatalogParams, type CatalogSort } from "@/server/storefront-catalog/params";
import type { CatalogCard, CatalogFacets, PublicTaxonomy } from "@/server/storefront-catalog/types";
import { getEmbedder, type Embedder, type EmbedderPart, type RgbImage } from "./embedder";
import { searchMetrics } from "./metrics";
import { getShopDictionary, parseWith, type ShopDictionary } from "./dictionary";
import { TtlLru } from "./lru";
import { STOPWORDS, fold, lexemes } from "./normalize";
import type { InterpretationChip, ParsedQuery } from "./parser";
import type { SuggestReason } from "./ui-labels";
import { exactMatches, lexicalSearch, orderIds, productVectors, vectorSearch, type ScoredId } from "./retrieval";
import { rrf, type RankedList } from "./rrf";
import { FUSION_K, IMAGE_MARGIN, IMAGE_MIN_SIMILARITY, IMAGE_TEXT_LIMIT, SIMILAR_MIN_Z, WEIGHTS, keepImageText, keepSemantic, semanticText, zScores } from "./ranking";

/*
 * Smart search — the public server API (docs/search.md § API):
 *
 *   searchProducts(tenantId, input)        hybrid search: results + interpretation + facets + timing
 *   suggest(tenantId, q, opts)             search-as-you-type (lexical/prefix + facet values + 5 items)
 *   searchByImage(tenantId, image, input)  photo search (+ optional text refinement)
 *   similarProducts(tenantId, productId)   "lijkt hierop" (image + text vectors of the product)
 *
 * Ranking: Reciprocal Rank Fusion of lexical (FTS + trigram), semantic (e5) and photo-space (SigLIP
 * text → image) lists; exact stock number / SKU hits pinned first. Filters (facets, price, tags,
 * category, compliance, visibility) are the catalog's own WHERE clause, so search never shows more
 * than the catalog. Models that are not warm yet are skipped (lexical still answers) and warmed in
 * the background — page renders never wait for a model.
 */

// ─── Limits (thresholds and weights: ./ranking.ts) ──────────────────────────

export const MAX_RESULTS = 500;
const LEXICAL_LIMIT = 200;
const SEMANTIC_LIMIT = 120;

// ─── Types ──────────────────────────────────────────────────────────────────

export type SearchFilters = {
  /** Facet tokens "<facetSlug>.<valueSlug>" (URL `f`). */
  facets?: string[];
  /** Facet value ids (saved-search links). */
  facetValueIds?: string[];
  /** Tag slugs (AND). */
  tags?: string[];
  /** Whole currency units. */
  min?: number | null;
  max?: number | null;
};

export type SearchInput = {
  q: string;
  filters?: SearchFilters;
  /** Default "relevance". */
  sort?: CatalogSort;
  /** Used when there is no free text left to rank by (e.g. "Duits WW2"): the listing default. */
  fallbackSort?: CatalogSort;
  /** 1-based. */
  page?: number;
  pageSize?: number;
  /** "Load more" mode: the first N results (overrides page). */
  show?: number | null;
  /** Catalog scope: mode (shop/archive), category subtree, compliance hide, price unit, locked facets. */
  scope?: Partial<ListScope>;
  /** Shop currency (chip labels). */
  currency?: string;
  /** false = take the query literally (no facet/price extraction). Default true. */
  interpret?: boolean;
  /** Compute facet counts for the result set. Default true. */
  facets?: boolean;
  /** Include per-retriever hits in the result (tuning / admin diagnostics). */
  explain?: boolean;
  /**
   * Also look for "close, but not all filters match" items (results page, page 1): when the query
   * was understood as filters and the result is small, re-run without the most restrictive one.
   */
  nearMisses?: boolean;
};

export type SearchInterpretation = {
  original: string;
  /** Free text that was searched (after removing understood phrases). */
  text: string;
  /** Facet tokens applied from the query (on top of explicit filters). */
  facets: string[];
  min: number | null;
  max: number | null;
  status: "sold" | null;
  sort: "price_asc" | "price_desc" | null;
  stockCode: number | null;
  chips: InterpretationChip[];
  /** Nothing matched with the understood filters: facet filters were dropped and their words searched as text. */
  relaxed: boolean;
};

export type RetrieverState = "used" | "cold" | "off" | "skipped";

export type SearchTiming = {
  totalMs: number;
  parseMs: number;
  lexicalMs: number;
  semanticMs: number;
  imageMs: number;
  facetsMs: number;
  cardsMs: number;
  semantic: RetrieverState;
  imageText: RetrieverState;
};

export type SearchResult = {
  items: CatalogCard[];
  total: number;
  page: number;
  pageSize: number;
  sort: CatalogSort;
  mode: CatalogMode;
  interpretation: SearchInterpretation;
  facets: CatalogFacets | null;
  timing: SearchTiming;
  explain?: SearchExplain;
  /** Only with `nearMisses: true` (null when not applicable or nothing extra was found). */
  nearMisses?: NearMisses | null;
  /** Photo search: visual similarity (cosine) per returned item id. */
  scores?: Record<string, number>;
};

/**
 * Items that match everything except one understood filter — the most restrictive one (the filter
 * whose removal adds the most items). `dropped` is that filter's chip (remove it to see them all).
 */
export type NearMisses = { dropped: InterpretationChip; items: CatalogCard[]; total: number };

/** Near-misses are only looked for when the exact result is at most this big (one page). */
export const NEAR_MISS_BELOW = PAGE_SIZE;
export const NEAR_MISS_LIMIT = 8;

// ─── Query embeddings (warm-or-skip, cached) ────────────────────────────────

const embedCache = new TtlLru<Promise<number[]>>(1000, 10 * 60 * 1000);

/**
 * A query embedding when that model part is warm; otherwise null (and the part starts loading).
 * Never blocks a request on model loading.
 */
async function embedIfWarm(embedder: Embedder | null, part: "text" | "imageText", text: string): Promise<{ vector: number[] | null; state: RetrieverState }> {
  if (!embedder) return { vector: null, state: "off" };
  const key = `${part}\u0000${embedder[part === "text" ? "textModel" : "imageModel"]}\u0000${text}`;
  const hit = embedCache.get(key);
  if (hit) return { vector: await hit, state: "used" };
  const status = embedder.status(part);
  if (status !== "ready") {
    // Service down/slow (circuit open): skip, and let the client probe for recovery in the background.
    embedder.warm(part);
    return { vector: null, state: status === "disabled" ? "off" : "cold" };
  }
  const p = part === "text" ? embedder.embedQuery(text) : embedder.embedImageQuery(text);
  embedCache.set(key, p);
  p.catch(() => embedCache.delete(key));
  try {
    return { vector: await p, state: "used" };
  } catch {
    // Timeout or error (logged once by the client): this search runs without this retriever.
    return { vector: null, state: "cold" };
  }
}

/** Tests/benchmarks: forget cached query embeddings. */
export function clearQueryEmbeddingCache(): void {
  embedCache.clear();
}

/** Starts loading the query-side models (e.g. from instrumentation or a health check). */
export async function warmSearchModels(parts: EmbedderPart[] = ["text", "imageText"]): Promise<void> {
  const e = await getEmbedder();
  for (const part of parts) e?.warm(part);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;


function emptyParsed(q: string): ParsedQuery {
  const text = q.replace(/\s+/g, " ").trim();
  const terms = [...new Set(lexemes(text).filter((w) => !STOPWORDS.has(w)))].slice(0, 8);
  return { original: text, text, terms, expansions: {}, facets: [], min: null, max: null, status: null, sort: null, stockCode: null, chips: [] };
}

/** Drops the facet filters understood from the query; their words become search text again. */
function relaxFacets(p: ParsedQuery): ParsedQuery {
  // TYPE words are already in the text ("helm"); add the others once.
  const have = new Set(lexemes(p.text));
  const words = p.chips.filter((c) => c.kind === "facet" && !lexemes(c.matched).every((w) => have.has(w))).map((c) => c.matched);
  const text = [p.text, ...words].filter(Boolean).join(" ");
  const terms = [...new Set([...p.terms, ...words.flatMap((w) => lexemes(w))].filter((w) => !STOPWORDS.has(w)))].slice(0, 8);
  return { ...p, text, terms, facets: [], chips: p.chips.filter((c) => c.kind !== "facet") };
}

/**
 * One query variant per understood filter (facet chips, and the price bounds as one), each without
 * that filter. Explicit URL filters are the visitor's own choice and are never dropped.
 */
export function nearMissVariants(p: ParsedQuery, explicit: SearchFilters = {}): { dropped: InterpretationChip; parsed: ParsedQuery }[] {
  const out: { dropped: InterpretationChip; parsed: ParsedQuery }[] = [];
  for (const chip of p.chips) {
    if (chip.kind !== "facet" || !chip.token || (explicit.facets ?? []).includes(chip.token)) continue;
    out.push({ dropped: chip, parsed: { ...p, facets: p.facets.filter((t) => t !== chip.token), chips: p.chips.filter((c) => c !== chip) } });
  }
  const price = p.chips.filter((c) => c.kind === "price");
  if (price.length && (explicit.min ?? null) === null && (explicit.max ?? null) === null) {
    const dropped = price.length === 1 ? price[0] : { ...price[0], label: price.map((c) => c.label).join(", ") };
    out.push({ dropped, parsed: { ...p, min: null, max: null, chips: p.chips.filter((c) => c.kind !== "price") } });
  }
  return out.slice(0, 4);
}

function interpretationOf(p: ParsedQuery, relaxed: boolean): SearchInterpretation {
  return { original: p.original, text: p.text, facets: p.facets, min: p.min, max: p.max, status: p.status, sort: p.sort, stockCode: p.stockCode, chips: p.chips, relaxed };
}

type Plan = {
  tenantId: string;
  scope: ListScope;
  /** Facet tokens: locked + explicit + understood. */
  tokens: string[];
  tags: string[];
  min: number | null;
  max: number | null;
  tax: PublicTaxonomy;
};

function whereFor(plan: Plan, withFacets = true): Prisma.Sql {
  const selection = withFacets ? resolveFacetSelection(plan.tax, plan.tokens) : [];
  return whereSql(plan.tenantId, { ...plan.scope, lockedFacets: [] }, { q: null, tags: plan.tags, min: plan.min, max: plan.max, selection });
}

/** Per-retriever hits (ids + scores) for tuning: `searchProducts(…, { explain: true })`. */
export type SearchExplain = { lexical: ScoredId[]; exact: string[]; semantic: ScoredId[]; imageText: ScoredId[]; semanticText: string };

type Retrieved = { fused: string[]; lexicalMs: number; semanticMs: number; imageMs: number; semantic: RetrieverState; imageText: RetrieverState; explain: SearchExplain };

async function retrieve(plan: Plan, where: Prisma.Sql, parsed: ParsedQuery, embedder: Embedder | null, opts: { imageText?: boolean } = {}): Promise<Retrieved> {
  const text = parsed.text.trim();
  const hasText = text.length > 0 && parsed.terms.length > 0;
  const t0 = performance.now();
  const lexicalP = (async () => {
    const t = performance.now();
    const [lex, exact] = await Promise.all([hasText ? lexicalSearch(where, parsed, LEXICAL_LIMIT) : Promise.resolve([] as ScoredId[]), exactMatches(where, parsed)]);
    return { lex, exact, ms: ms(t) };
  })();
  const semanticP = (async () => {
    if (!hasText) return { hits: [] as ScoredId[], state: "skipped" as RetrieverState, ms: 0 };
    const { vector, state } = await embedIfWarm(embedder, "text", semanticText(parsed));
    if (!vector || !embedder) return { hits: [] as ScoredId[], state, ms: ms(t0) };
    // Unfiltered candidates: the keep rules need the spread of scores (applied after fusion inputs are in).
    const hits = await vectorSearch(plan.tenantId, where, vector, { kind: "text", dim: embedder.textDim, limit: SEMANTIC_LIMIT });
    return { hits, state, ms: ms(t0) };
  })();
  const imageP = (async () => {
    if (!hasText || opts.imageText === false) return { hits: [] as ScoredId[], state: "skipped" as RetrieverState, ms: 0 };
    const { vector, state } = await embedIfWarm(embedder, "imageText", semanticText(parsed));
    if (!vector || !embedder) return { hits: [] as ScoredId[], state, ms: ms(t0) };
    const hits = await vectorSearch(plan.tenantId, where, vector, { kind: "image", dim: embedder.imageDim, limit: IMAGE_TEXT_LIMIT });
    return { hits, state, ms: ms(t0) };
  })();
  const [lexical, semantic, image] = await Promise.all([lexicalP, semanticP, imageP]);
  if (semantic.state === "cold" || image.state === "cold") searchMetrics.lexicalFallbacks += 1;
  const lexicalIds = new Set([...lexical.lex.map((h) => h.id), ...lexical.exact]);
  const semanticHits = keepSemantic(semantic.hits, lexicalIds);
  const imageHits = keepImageText(image.hits, new Set([...lexicalIds, ...semanticHits.map((h) => h.id)]));
  const lists: RankedList[] = [
    { name: "lexical", ids: lexical.lex.map((h) => h.id), weight: WEIGHTS.lexical },
    { name: "semantic", ids: semanticHits.map((h) => h.id), weight: WEIGHTS.semantic },
    { name: "imageText", ids: imageHits.map((h) => h.id), weight: WEIGHTS.imageText },
  ];
  const fused = rrf(lists, { pinned: lexical.exact, limit: MAX_RESULTS, k: FUSION_K }).map((h) => h.id);
  const explain = { lexical: lexical.lex, exact: lexical.exact, semantic: semanticHits, imageText: imageHits, semanticText: semanticText(parsed) };
  return { fused, lexicalMs: lexical.ms, semanticMs: semantic.ms, imageMs: image.ms, semantic: semantic.state, imageText: image.state, explain };
}

async function listIds(where: Prisma.Sql, order: Prisma.Sql): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT p.id FROM products p WHERE ${where} ORDER BY ${order} LIMIT ${MAX_RESULTS}`;
  return rows.map((r) => r.id);
}

// ─── searchProducts ─────────────────────────────────────────────────────────

export async function searchProducts(tenantId: string, input: SearchInput): Promise<SearchResult> {
  const started = performance.now();
  const currency = input.currency ?? "EUR";
  const tParse = performance.now();
  const dict = await getShopDictionary(tenantId, currency);
  let parsed = input.interpret === false ? emptyParsed(input.q) : parseWith(dict, input.q);
  const parseMs = ms(tParse);

  const filters = input.filters ?? {};
  const baseScope: ListScope = { mode: "shop", categoryIds: null, ...input.scope };
  // "verkocht" searches the sold archive (only where the archive is the alternative to the shop list).
  const mode: CatalogMode = parsed.status === "sold" ? "archive" : baseScope.mode;
  const scope: ListScope = { ...baseScope, mode };
  const explicitTokens = [...(baseScope.lockedFacets ?? []), ...(filters.facets ?? []), ...tokensForValueIds(dict.taxonomy, filters.facetValueIds ?? [])];
  const requestedSort = input.sort ?? "relevance";
  const sort: CatalogSort = requestedSort === "relevance" && parsed.sort ? parsed.sort : requestedSort;

  const embedder = await getEmbedder();
  const planFor = (p: ParsedQuery): Plan => ({
    tenantId,
    scope,
    tax: dict.taxonomy,
    tokens: [...new Set([...explicitTokens, ...p.facets])],
    tags: filters.tags ?? [],
    min: filters.min ?? p.min ?? null,
    max: filters.max ?? p.max ?? null,
  });

  let relaxed = false;
  let plan = planFor(parsed);
  const run = async (p: ParsedQuery, pl: Plan) => {
    const where = whereFor(pl);
    const textless = !p.text.trim() || !p.terms.length;
    if (textless && p.stockCode === null) {
      // Only filters were understood ("Duits WW2"): a filtered listing in the listing order.
      const order = orderSql(sort === "relevance" ? (input.fallbackSort ?? "newest") : sort, pl.scope.mode);
      const t = performance.now();
      return { fused: await listIds(where, order), lexicalMs: ms(t), semanticMs: 0, imageMs: 0, semantic: "skipped" as RetrieverState, imageText: "skipped" as RetrieverState, explain: undefined, listing: true };
    }
    return { ...(await retrieve(pl, where, p, embedder)), listing: false };
  };
  let r = await run(parsed, plan);
  if (!r.fused.length && parsed.facets.length) {
    parsed = relaxFacets(parsed);
    plan = planFor(parsed);
    relaxed = true;
    r = await run(parsed, plan);
  }

  // "Close, but not all filters match": drop one understood filter at a time (in parallel), keep the
  // variant that adds the most items. Query embeddings are cached, so each variant costs SQL only.
  const nearMissesP = (async (): Promise<NearMisses | null> => {
    if (!input.nearMisses || relaxed || (input.page ?? 1) > 1 || r.fused.length >= NEAR_MISS_BELOW) return null;
    const variants = nearMissVariants(parsed, filters);
    if (!variants.length) return null;
    const have = new Set(r.fused);
    const runs = await Promise.all(
      variants.map(async (v) => {
        const res = await run(v.parsed, planFor(v.parsed));
        const extra = res.fused.filter((id) => !have.has(id));
        return { dropped: v.dropped, extra };
      }),
    );
    const best = runs.reduce<(typeof runs)[number] | null>((a, b) => (b.extra.length > (a?.extra.length ?? 0) ? b : a), null);
    if (!best) return null;
    let extra = best.extra;
    if (sort !== "relevance") extra = await orderIds(extra, orderSql(sort, scope.mode));
    return { dropped: best.dropped, total: extra.length, items: await loadCards(tenantId, extra.slice(0, NEAR_MISS_LIMIT)) };
  })();

  // Order + page.
  let ids = r.fused;
  if (!r.listing && sort !== "relevance") ids = await orderIds(ids, orderSql(sort, scope.mode));
  const pageSize = input.pageSize ?? PAGE_SIZE;
  const page = Math.max(1, input.page ?? 1);
  const show = input.show ? Math.min(MAX_SHOW, input.show) : null;
  const slice = show ? ids.slice(0, show) : ids.slice((page - 1) * pageSize, page * pageSize);

  const tCards = performance.now();
  const facetsP = (async () => {
    if (input.facets === false) return { facets: null as CatalogFacets | null, ms: 0 };
    const t = performance.now();
    // Counts must stay "OR within a facet": count over the candidates WITHOUT facet filters, and let
    // getCatalogFacets apply the selection per facet itself.
    // A pure filter listing (no text) counts like the catalog itself: no id restriction.
    let candidates: string[] | null = r.listing ? null : ids;
    if (plan.tokens.length && !r.listing) candidates = (await retrieve(plan, whereFor(plan, false), parsed, embedder, { imageText: false })).fused;
    const params: CatalogParams = {
      q: null,
      facets: plan.tokens,
      facetValueIds: [],
      tags: plan.tags,
      min: plan.min,
      max: plan.max,
      sort: "newest",
      page: 1,
      show: null,
      view: null,
    };
    const facets = await getCatalogFacets(tenantId, { ...scope, lockedFacets: [], ids: candidates }, params);
    return { facets, ms: ms(t) };
  })();
  const [items, facetRes, nearMisses] = await Promise.all([loadCards(tenantId, slice), facetsP, nearMissesP]);
  const cardsMs = ms(tCards);

  return {
    items,
    total: ids.length,
    page,
    pageSize,
    sort,
    mode: scope.mode,
    interpretation: interpretationOf(parsed, relaxed),
    facets: facetRes.facets,
    ...(input.explain && r.explain ? { explain: r.explain } : {}),
    ...(input.nearMisses ? { nearMisses } : {}),
    timing: {
      totalMs: ms(started),
      parseMs,
      lexicalMs: r.lexicalMs,
      semanticMs: r.semanticMs,
      imageMs: r.imageMs,
      facetsMs: facetRes.ms,
      cardsMs,
      semantic: r.semantic,
      imageText: r.imageText,
    },
  };
}

// ─── suggest ────────────────────────────────────────────────────────────────

export type FacetSuggestion = {
  token: string;
  facet: string;
  value: string;
  /** "Country: Germany" */
  label: string;
};

/** Why a suggested product matched (the dropdown's "why" line: ./ui-labels.ts). */
export type { SuggestReason } from "./ui-labels";

export type Suggestions = {
  query: string;
  interpretation: SearchInterpretation;
  /** Facet values matching the words typed so far (prefix of the last word, or understood words). */
  facets: FacetSuggestion[];
  products: CatalogCard[];
  /** Per product id. */
  reasons: Record<string, SuggestReason>;
  /**
   * Matches found while suggesting (exact + lexical + kept semantic hits, or the filtered listing):
   * the "See all N results" count. `totalCapped`: there are at least this many (the suggest
   * retrievers stop early); the results page may find a few more through the language model.
   */
  total: number;
  totalCapped: boolean;
  timing: { totalMs: number; semantic: RetrieverState };
};

/** Lexical candidates the suggest count is based on (= its rank cap: costs no extra ranking). */
const SUGGEST_COUNT_CAP = 300;

/** Words of ≥ 2 letters; the last one is matched as a prefix. */
function facetSuggestions(dict: ShopDictionary, q: string, understood: string[]): FacetSuggestion[] {
  const out: FacetSuggestion[] = [];
  const seen = new Set<string>();
  const push = (facetSlug: string, valueSlug: string) => {
    const token = facetToken(facetSlug, valueSlug);
    if (seen.has(token)) return;
    const facet = dict.taxonomy.facets.find((f) => f.slug === facetSlug);
    const value = facet && dict.taxonomy.values.find((v) => v.facetId === facet.id && v.slug === valueSlug);
    if (!facet || !value || !facet.isFilterable) return;
    seen.add(token);
    out.push({ token, facet: facet.name, value: value.name, label: `${facet.name}: ${value.name}` });
  };
  for (const token of understood) {
    const [f, v] = token.split(".");
    push(f, v);
  }
  const words = fold(q).split(" ").filter(Boolean);
  const last = words.at(-1) ?? "";
  if (last.length >= 2) {
    for (const [phrase, target] of dict.prepared.dict) {
      if (out.length >= 6) break;
      if (target.kind !== "facet") continue;
      if (phrase.startsWith(last) || phrase.split(" ").some((w) => w.startsWith(last))) push(target.facetSlug, target.valueSlug);
    }
  }
  return out.slice(0, 6);
}

/**
 * Search-as-you-type. Lexical (prefix) + exact first; the semantic model only for ≥ 3 words or when
 * lexical finds nothing (and only when warm). Target p95 < 60 ms server time.
 */
export async function suggest(tenantId: string, q: string, opts: { scope?: Partial<ListScope>; currency?: string; limit?: number } = {}): Promise<Suggestions> {
  const started = performance.now();
  const dict = await getShopDictionary(tenantId, opts.currency ?? "EUR");
  const parsed = parseWith(dict, q);
  const scope: ListScope = { mode: "shop", categoryIds: null, ...opts.scope };
  const plan: Plan = { tenantId, scope, tax: dict.taxonomy, tokens: [...(scope.lockedFacets ?? []), ...parsed.facets], tags: [], min: parsed.min, max: parsed.max };
  const where = whereFor(plan);
  const limit = opts.limit ?? 5;
  const hasText = parsed.text.trim().length > 0 && parsed.terms.length > 0;
  // Suggestions rank a smaller sample of the matches (300): a dropdown needs 5 good items, fast.
  const [lex, exact] = await Promise.all([hasText ? lexicalSearch(where, parsed, SUGGEST_COUNT_CAP, SUGGEST_COUNT_CAP) : Promise.resolve([] as ScoredId[]), exactMatches(where, parsed)]);
  let semanticState: RetrieverState = "skipped";
  let semantic: ScoredId[] = [];
  const words = parsed.text.split(" ").filter(Boolean).length;
  if (hasText && (words >= 3 || lex.length === 0)) {
    const embedder = await getEmbedder();
    const { vector, state } = await embedIfWarm(embedder, "text", semanticText(parsed));
    semanticState = state;
    if (vector && embedder) semantic = keepSemantic(await vectorSearch(tenantId, where, vector, { kind: "text", dim: embedder.textDim, limit: 60 }), new Set(lex.map((h) => h.id)));
  }
  const all = rrf(
    [
      { name: "lexical", ids: lex.map((h) => h.id) },
      { name: "semantic", ids: semantic.map((h) => h.id) },
    ],
    { pinned: exact, limit: SUGGEST_COUNT_CAP * 2, k: FUSION_K },
  ).map((h) => h.id);
  let ids = all.slice(0, limit);
  let total = all.length;
  let totalCapped = lex.length >= SUGGEST_COUNT_CAP;
  const reasons: Record<string, SuggestReason> = {};
  const exactSet = new Set(exact);
  const lexById = new Map(lex.map((h) => [h.id, h]));
  for (const id of ids) reasons[id] = exactSet.has(id) ? "exact" : lexById.has(id) ? (lexById.get(id)!.fuzzy ? "typo" : "lexical") : "semantic";
  if (!ids.length && !hasText && (parsed.facets.length || parsed.min !== null || parsed.max !== null)) {
    const listed = await listIds(where, orderSql("newest", scope.mode));
    ids = listed.slice(0, limit);
    total = listed.length;
    totalCapped = listed.length >= MAX_RESULTS;
    for (const id of ids) reasons[id] = "filters";
  }
  const products = await loadCards(tenantId, ids);
  return {
    query: parsed.original,
    interpretation: interpretationOf(parsed, false),
    facets: facetSuggestions(dict, q, parsed.facets),
    products,
    reasons,
    total,
    totalCapped,
    timing: { totalMs: ms(started), semantic: semanticState },
  };
}

// ─── searchByImage ──────────────────────────────────────────────────────────

export class SearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

export type ImageSearchInput = Omit<SearchInput, "q" | "interpret" | "fallbackSort"> & { q?: string };

/**
 * Products whose main photo looks like `image` (decoded RGB, see ./image-input.ts). With `q`, the
 * text refines the result (its understood filters apply; its lexical/semantic ranks fuse in).
 * Photo search has no lexical fallback: throws SearchUnavailableError when the embedder is not
 * configured, down or slower than its photo timeout (2 s).
 */
export async function searchByImage(tenantId: string, image: RgbImage, input: ImageSearchInput = {}): Promise<SearchResult> {
  const started = performance.now();
  const embedder = await getEmbedder();
  if (!embedder) throw new SearchUnavailableError("Photo search is not available");
  if (embedder.status("image") !== "ready") {
    embedder.warm("image");
    throw new SearchUnavailableError("Photo search is not available right now");
  }
  const tImg = performance.now();
  let vector: number[];
  try {
    vector = await embedder.embedImage(image);
  } catch {
    throw new SearchUnavailableError("Photo search is not available right now");
  }
  const currency = input.currency ?? "EUR";
  const dict = await getShopDictionary(tenantId, currency);
  const parsed = input.q?.trim() ? parseWith(dict, input.q) : emptyParsed("");
  const filters = input.filters ?? {};
  const scope: ListScope = { mode: "shop", categoryIds: null, ...input.scope };
  const plan: Plan = {
    tenantId,
    scope,
    tax: dict.taxonomy,
    tokens: [...new Set([...(scope.lockedFacets ?? []), ...(filters.facets ?? []), ...tokensForValueIds(dict.taxonomy, filters.facetValueIds ?? []), ...parsed.facets])],
    tags: filters.tags ?? [],
    min: filters.min ?? parsed.min,
    max: filters.max ?? parsed.max,
  };
  const where = whereFor(plan);
  const candidates = await vectorSearch(tenantId, where, vector, { kind: "image", dim: embedder.imageDim, limit: 96, minSimilarity: IMAGE_MIN_SIMILARITY });
  const visual = candidates.filter((h) => h.score >= (candidates[0]?.score ?? 1) - IMAGE_MARGIN);
  const imageMs = ms(tImg);
  const lists: RankedList[] = [{ name: "image", ids: visual.map((h) => h.id), weight: 1 }];
  let text: Retrieved | null = null;
  if (parsed.text.trim() && parsed.terms.length) {
    text = await retrieve(plan, where, parsed, embedder, { imageText: false });
    // Refinement: keep visual matches, re-ranked by agreement with the text.
    lists.push({ name: "text", ids: text.fused.filter((id) => visual.some((v) => v.id === id)), weight: 0.6 });
  }
  let ids = rrf(lists, { limit: MAX_RESULTS, k: FUSION_K }).map((h) => h.id);
  const sort = input.sort ?? "relevance";
  if (sort !== "relevance") ids = await orderIds(ids, orderSql(sort, scope.mode));
  const pageSize = input.pageSize ?? PAGE_SIZE;
  const page = Math.max(1, input.page ?? 1);
  const tCards = performance.now();
  const pageIds = ids.slice((page - 1) * pageSize, page * pageSize);
  const items = await loadCards(tenantId, pageIds);
  const visualScore = new Map(candidates.map((h) => [h.id, h.score]));
  const scores = Object.fromEntries(pageIds.flatMap((id) => (visualScore.has(id) ? [[id, visualScore.get(id)!]] : [])));
  return {
    scores,
    items,
    total: ids.length,
    page,
    pageSize,
    sort,
    mode: scope.mode,
    interpretation: interpretationOf(parsed, false),
    facets: null,
    timing: {
      totalMs: ms(started),
      parseMs: 0,
      lexicalMs: text?.lexicalMs ?? 0,
      semanticMs: text?.semanticMs ?? 0,
      imageMs,
      facetsMs: 0,
      cardsMs: ms(tCards),
      semantic: text?.semantic ?? "skipped",
      imageText: "skipped",
    },
  };
}

// ─── similarProducts ────────────────────────────────────────────────────────

/**
 * "Lijkt hierop": products near this one by photo and by text, for sale only (or the given scope),
 * never the product itself. Each neighbour list is scored as z-scores among its own candidates and
 * the two are summed — an item must look alike AND/OR read alike clearly more than the rest
 * (neighbour cosines are dense: 0.85–0.92 for everything shot the same way). Empty when the product
 * has no embeddings yet or nothing stands out.
 */
export async function similarProducts(tenantId: string, productId: string, opts: { limit?: number; scope?: Partial<ListScope> } = {}): Promise<CatalogCard[]> {
  const limit = opts.limit ?? 8;
  const vectors = await productVectors(tenantId, productId);
  if (!vectors.text && !vectors.image) return [];
  const scope: ListScope = { mode: "shop", categoryIds: null, ...opts.scope };
  const where = whereSql(tenantId, { ...scope, lockedFacets: [] }, { q: null, tags: [], min: null, max: null, selection: [] });
  const [byImage, byText] = await Promise.all([
    vectors.image ? vectorSearch(tenantId, where, vectors.image, { kind: "image", dim: vectors.image.length, limit: 60, excludeId: productId }) : Promise.resolve([]),
    vectors.text ? vectorSearch(tenantId, where, vectors.text, { kind: "text", dim: vectors.text.length, limit: 60, excludeId: productId }) : Promise.resolve([]),
  ]);
  const zi = zScores(byImage);
  const zt = zScores(byText);
  const ids = [...new Set([...byImage, ...byText].map((h) => h.id))]
    .map((id) => ({ id, z: (zi.get(id) ?? 0) + (zt.get(id) ?? 0) }))
    .filter((h) => h.z >= SIMILAR_MIN_Z)
    .sort((a, b) => b.z - a.z || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((h) => h.id);
  return loadCards(tenantId, ids);
}
