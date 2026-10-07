/**
 * Saved-search query shape + the matcher that decides whether a (newly published) product matches a
 * saved search. Pure: no DB, no server-only — unit tested in match.test.ts and usable anywhere.
 *
 * Stored query (`SavedSearch.query`, JSON), normalised:
 *   q              free text — every word must occur in title/description/sku (case-insensitive),
 *                  a numeric word may also equal the stock code; a leading "#" is ignored
 *                  (mirrors the storefront catalog search, src/server/storefront-catalog/queries.ts)
 *   categoryId     product's category must be this category OR one of its descendants
 *   tagIds         product must carry EVERY tag (AND, like the catalog `tag` filter)
 *   facetValueIds  grouped by facet: AND across facets, OR within one facet; a product value also
 *                  matches when one of its ANCESTOR values is selected (selecting "Germany" matches a
 *                  product tagged "Germany › Heer")
 *   priceMin/Max   inclusive bounds in MINOR units of the shop currency
 * An empty query matches every new arrival ("All new arrivals").
 */

export type SavedSearchQuery = {
  q: string | null;
  categoryId: string | null;
  tagIds: string[];
  facetValueIds: string[];
  /** Minor units. */
  priceMin: number | null;
  /** Minor units. */
  priceMax: number | null;
};

export const MAX_QUERY_TEXT = 100;
export const MAX_QUERY_IDS = 20;
const MAX_WORDS = 8;
const MAX_PRICE = 1_000_000_000; // minor units

export const EMPTY_QUERY: SavedSearchQuery = { q: null, categoryId: null, tagIds: [], facetValueIds: [], priceMin: null, priceMax: null };

function cleanId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

function cleanIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(cleanId).filter((x): x is string => x !== null))].sort().slice(0, MAX_QUERY_IDS);
}

function cleanPrice(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_PRICE ? n : null;
}

/**
 * Tolerant normalisation of any JSON (stored rows, form input). Unknown keys are dropped, ids are
 * de-duplicated and sorted (so equal searches compare equal), min/max are swapped when reversed.
 */
export function normalizeQuery(raw: unknown): SavedSearchQuery {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const q = typeof o.q === "string" ? o.q.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_TEXT) || null : null;
  let priceMin = cleanPrice(o.priceMin);
  let priceMax = cleanPrice(o.priceMax);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  return {
    q,
    categoryId: cleanId(o.categoryId),
    tagIds: cleanIds(o.tagIds),
    facetValueIds: cleanIds(o.facetValueIds),
    priceMin,
    priceMax,
  };
}

export function isEmptyQuery(q: SavedSearchQuery): boolean {
  return !q.q && !q.categoryId && !q.tagIds.length && !q.facetValueIds.length && q.priceMin === null && q.priceMax === null;
}

/** Stable key: two searches with the same key are duplicates. */
export function queryKey(q: SavedSearchQuery): string {
  return JSON.stringify([q.q?.toLowerCase() ?? null, q.categoryId, q.tagIds, q.facetValueIds, q.priceMin, q.priceMax]);
}

/** Search words as the catalog uses them. */
export function queryWords(q: string | null): string[] {
  if (!q) return [];
  return q
    .split(" ")
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .map((w) => w.replace(/^#/, "").toLowerCase())
    .filter(Boolean);
}

export type ProductFacts = {
  title: string;
  description: string | null;
  sku: string | null;
  stockCode: number;
  /** Minor units. */
  price: number;
  categoryId: string | null;
  tagIds: string[];
  facetValueIds: string[];
};

/** Lookups the matcher needs: the category tree and the facet value tree of the tenant. */
export type MatchLookups = {
  /** categoryId → parentId */
  categoryParent: ReadonlyMap<string, string | null>;
  /** facetValueId → { facetId, parentId } */
  facetValues: ReadonlyMap<string, { facetId: string; parentId: string | null }>;
};

/** The id and all ancestor ids of a node (cycle-safe). */
export function withAncestors(id: string, parentOf: (id: string) => string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = id;
  while (cur && !seen.has(cur) && out.length < 64) {
    seen.add(cur);
    out.push(cur);
    cur = parentOf(cur);
  }
  return out;
}

export function matchesText(words: string[], p: Pick<ProductFacts, "title" | "description" | "sku" | "stockCode">): boolean {
  const hay = [p.title, p.description ?? "", p.sku ?? ""].join("\n").toLowerCase();
  return words.every((w) => hay.includes(w) || (/^\d{1,9}$/.test(w) && Number(w) === p.stockCode));
}

export function matchesQuery(query: SavedSearchQuery, p: ProductFacts, lookups: MatchLookups): boolean {
  if (query.priceMin !== null && p.price < query.priceMin) return false;
  if (query.priceMax !== null && p.price > query.priceMax) return false;

  if (query.categoryId) {
    if (!p.categoryId) return false;
    const chain = withAncestors(p.categoryId, (id) => lookups.categoryParent.get(id));
    if (!chain.includes(query.categoryId)) return false;
  }

  if (query.tagIds.length) {
    const have = new Set(p.tagIds);
    if (!query.tagIds.every((t) => have.has(t))) return false;
  }

  if (query.facetValueIds.length) {
    // Group the selected values by facet. A selected value that no longer exists can never match.
    const groups = new Map<string, Set<string>>();
    for (const id of query.facetValueIds) {
      const fv = lookups.facetValues.get(id);
      if (!fv) return false;
      const g = groups.get(fv.facetId) ?? new Set<string>();
      g.add(id);
      groups.set(fv.facetId, g);
    }
    const productValues = new Set(p.facetValueIds.flatMap((id) => withAncestors(id, (x) => lookups.facetValues.get(x)?.parentId)));
    for (const g of groups.values()) {
      if (![...g].some((id) => productValues.has(id))) return false;
    }
  }

  const words = queryWords(query.q);
  if (words.length && !matchesText(words, p)) return false;
  return true;
}
