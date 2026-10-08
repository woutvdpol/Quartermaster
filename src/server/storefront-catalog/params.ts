/**
 * URL state of the shop catalog. `searchParams` are the single source of truth (legacy Livewire
 * `#[Url]` state, made readable). Pure — used by pages, client filter components and tests.
 *
 *   q        search text (title / description / stock code "#50231")
 *   f        facet value "<facetSlug>.<valueSlug>", repeatable — OR within a facet, AND across
 *            facets; a value also matches its descendants (e.g. f=country.germany&f=period.ww2).
 *            Also accepted: f=<facetValueId> (cuid; used by saved-search links) — the shop page
 *            redirects those to the readable token form.
 *   tag      tag slug, repeatable (AND: every selected tag must match) — for tags not (yet) mapped
 *            to a facet
 *   min,max  price bounds in whole units of the shop currency
 *   sort     newest | oldest | price_asc | price_desc | featured | updated | relevance
 *            (relevance = smart-search ranking, src/server/search; the default whenever q is set,
 *            ignored without q)
 *   page     1-based page
 *   show     "load more" mode: number of items to show from the start (multiple of the page size)
 *   view     grid | list (overrides settings.catalog.layout for this visitor)
 * The category lives in the path (/shop/category/{slug}), never in the query.
 */

export const CATALOG_SORTS = ["newest", "oldest", "price_asc", "price_desc", "featured", "updated", "relevance"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
export type CatalogView = "grid" | "list";

export const PAGE_SIZE = 24;
export const MAX_SHOW = PAGE_SIZE * 10;
export const MAX_TAGS = 10;
export const MAX_FACET_VALUES = 20;
export const MAX_QUERY_LENGTH = 100;
const MAX_PAGE = 1000;

export type CatalogParams = {
  q: string | null;
  /** Facet tokens "<facetSlug>.<valueSlug>" (deduplicated, input order). */
  facets: string[];
  /** Facet value ids given directly as f=<id> (saved-search links). Resolve both forms with selectedFacetValueIds(). */
  facetValueIds: string[];
  tags: string[];
  /** Whole currency units. */
  min: number | null;
  max: number | null;
  sort: CatalogSort;
  page: number;
  /** Set in load-more mode; overrides paging (offset 0, limit = show). */
  show: number | null;
  view: CatalogView | null;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function positiveInt(v: string | undefined, max: number): number | null {
  if (!v || !/^\d{1,9}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return n >= 0 && n <= max ? n : null;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Facet value id (cuid) in an `f` param. */
const FACET_VALUE_ID = /^c[a-z0-9]{20,32}$/;
const FACET_TOKEN = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** URL token for a facet value: "<facetSlug>.<valueSlug>" (slugs never contain dots). */
export const facetToken = (facetSlug: string, valueSlug: string) => `${facetSlug}.${valueSlug}`;

/** Splits a facet token, or null when malformed. */
export function parseFacetToken(token: string): { facet: string; value: string } | null {
  const m = FACET_TOKEN.exec(token);
  return m && token.length <= 200 ? { facet: m[1], value: m[2] } : null;
}

/** Tokens grouped by facet slug (insertion order). */
export function groupFacetTokens(tokens: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of tokens) {
    const parsed = parseFacetToken(t);
    if (!parsed) continue;
    out.set(parsed.facet, [...(out.get(parsed.facet) ?? []), parsed.value]);
  }
  return out;
}

export function parseCatalogParams(raw: RawSearchParams, defaultSort: CatalogSort = "newest"): CatalogParams {
  const q = (first(raw.q) ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH) || null;
  const rawF = all(raw.f).map((t) => t.trim());
  const facets = [...new Set(rawF.map((t) => t.toLowerCase()).filter((t) => parseFacetToken(t) !== null))].slice(0, MAX_FACET_VALUES);
  const facetValueIds = [...new Set(rawF.filter((t) => FACET_VALUE_ID.test(t)))].slice(0, MAX_FACET_VALUES);
  const tags = [...new Set(all(raw.tag).map((t) => t.trim().toLowerCase()).filter((t) => t.length <= 120 && SLUG.test(t)))].slice(0, MAX_TAGS);
  let min = positiveInt(first(raw.min), 10_000_000);
  let max = positiveInt(first(raw.max), 10_000_000);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  if (min === 0) min = null;
  const sortRaw = first(raw.sort);
  let sort = (CATALOG_SORTS as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as CatalogSort) : defaultSort;
  // Relevance only exists for a search; without q fall back to the listing default.
  if (sort === "relevance" && !q) sort = defaultSort === "relevance" ? "newest" : defaultSort;
  const page = Math.max(1, positiveInt(first(raw.page), MAX_PAGE) ?? 1);
  const showRaw = positiveInt(first(raw.show), MAX_SHOW);
  const show = showRaw && showRaw > PAGE_SIZE ? Math.min(MAX_SHOW, Math.ceil(showRaw / PAGE_SIZE) * PAGE_SIZE) : null;
  const viewRaw = first(raw.view);
  const view = viewRaw === "grid" || viewRaw === "list" ? viewRaw : null;
  return { q, facets, facetValueIds, tags, min, max, sort, page, show, view };
}

/**
 * Default sort of a catalog view: "relevance" while searching (so `?q=` URLs stay clean), else the
 * listing default. Parse twice: `parseCatalogParams(raw, searchDefaultSort(raw, listingDefault))`.
 */
export function searchDefaultSort(raw: RawSearchParams, listingDefault: CatalogSort): CatalogSort {
  const q = (first(raw.q) ?? "").trim();
  return q ? "relevance" : listingDefault;
}

/** Filters that narrow the result set (used for "active filters", noindex and clear-all). */
export function hasActiveFilters(p: CatalogParams): boolean {
  return Boolean(p.q || p.facets.length || p.facetValueIds.length || p.tags.length || p.min !== null || p.max !== null);
}

/**
 * Serialises params back to a query string, omitting defaults. `patch` overrides fields; changing any
 * filter resets paging unless `page`/`show` are part of the patch.
 */
export function catalogQueryString(p: CatalogParams, patch: Partial<CatalogParams> = {}, defaultSort: CatalogSort = "newest"): string {
  const resetsPaging = Object.keys(patch).some((k) => k !== "page" && k !== "show" && k !== "view");
  const next: CatalogParams = { ...p, ...(resetsPaging ? { page: 1, show: null } : {}), ...patch };
  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  for (const f of next.facets) sp.append("f", f);
  for (const f of next.facetValueIds) sp.append("f", f);
  for (const t of next.tags) sp.append("tag", t);
  if (next.min !== null) sp.set("min", String(next.min));
  if (next.max !== null) sp.set("max", String(next.max));
  if (next.sort !== defaultSort) sp.set("sort", next.sort);
  if (next.show) sp.set("show", String(next.show));
  else if (next.page > 1) sp.set("page", String(next.page));
  if (next.view) sp.set("view", next.view);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Offset/limit for the current params. */
export function catalogWindow(p: CatalogParams): { offset: number; limit: number } {
  if (p.show) return { offset: 0, limit: p.show };
  return { offset: (p.page - 1) * PAGE_SIZE, limit: PAGE_SIZE };
}

/** Maps the admin "defaultSort" setting onto a catalog sort. */
export function sortFromSetting(setting: string): CatalogSort {
  switch (setting) {
    case "price_asc":
    case "price_desc":
    case "newest":
    case "oldest":
    case "featured":
    case "updated":
      return setting;
    default:
      return "newest";
  }
}
