import "server-only";
import { db } from "@/server/db";
import { categoryHref, SHOP_PATH } from "@/server/storefront-catalog/urls";
import { EMPTY_QUERY, isEmptyQuery, normalizeQuery, type SavedSearchQuery } from "./match";

/*
 * Bridges between the storefront's catalog URL state and the stored saved-search query, plus
 * human-readable descriptions for the UI and mails. Tenant-scoped: ids of other shops are dropped.
 */

/**
 * What the shop UI hands to "Save this search": the catalog's parsed URL params as they are
 * (see src/server/storefront-catalog/params.ts) plus the category of the current page.
 *   tags  = tag SLUGS (the `tag` param);  min/max = WHOLE currency units (the `min`/`max` params)
 *   facetValueIds = FacetValue ids of the facet filter (the `f` param), if any
 */
export type CatalogSearchInput = {
  q?: string | null;
  categoryId?: string | null;
  tags?: string[];
  tagIds?: string[];
  facetValueIds?: string[];
  min?: number | null;
  max?: number | null;
};

const MINOR_PER_UNIT = 100;

/** Converts catalog params to a stored query, resolving tag slugs and dropping foreign/unknown ids. */
export async function queryFromCatalogInput(tenantId: string, input: CatalogSearchInput): Promise<SavedSearchQuery> {
  const slugs = (input.tags ?? []).filter((s) => typeof s === "string").slice(0, 20);
  const tagsBySlug = slugs.length
    ? await db.tag.findMany({ where: { tenantId, slug: { in: slugs } }, select: { id: true } })
    : [];
  const unit = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * MINOR_PER_UNIT) : null);
  return resolveQuery(tenantId, {
    q: input.q ?? null,
    categoryId: input.categoryId ?? null,
    tagIds: [...(input.tagIds ?? []), ...tagsBySlug.map((t) => t.id)],
    facetValueIds: input.facetValueIds ?? [],
    priceMin: unit(input.min),
    priceMax: unit(input.max),
  });
}

/** Normalises a query and keeps only ids that exist in this tenant. */
export async function resolveQuery(tenantId: string, raw: unknown): Promise<SavedSearchQuery> {
  const q = normalizeQuery(raw);
  const [category, tags, values] = await Promise.all([
    q.categoryId ? db.category.findFirst({ where: { tenantId, id: q.categoryId }, select: { id: true } }) : null,
    q.tagIds.length ? db.tag.findMany({ where: { tenantId, id: { in: q.tagIds } }, select: { id: true } }) : [],
    q.facetValueIds.length ? db.facetValue.findMany({ where: { tenantId, id: { in: q.facetValueIds } }, select: { id: true } }) : [],
  ]);
  return normalizeQuery({
    ...q,
    categoryId: category?.id ?? null,
    tagIds: tags.map((t) => t.id),
    facetValueIds: values.map((v) => v.id),
  });
}

export type QueryDescription = {
  text: string | null;
  category: { id: string; title: string; slug: string } | null;
  tags: { id: string; name: string; slug: string }[];
  facets: { id: string; name: string; facet: string }[];
  priceMin: number | null;
  priceMax: number | null;
  /** Shop path that shows the search (category page + query string). */
  href: string;
};

export async function describeQuery(tenantId: string, raw: unknown): Promise<QueryDescription> {
  return (await describeQueries(tenantId, [raw]))[0];
}

/** Batch version (one query per lookup table for a whole list). */
export async function describeQueries(tenantId: string, raws: unknown[]): Promise<QueryDescription[]> {
  const queries = raws.map(normalizeQuery);
  const catIds = [...new Set(queries.map((q) => q.categoryId).filter((x): x is string => !!x))];
  const tagIds = [...new Set(queries.flatMap((q) => q.tagIds))];
  const fvIds = [...new Set(queries.flatMap((q) => q.facetValueIds))];
  const [cats, tags, fvs] = await Promise.all([
    catIds.length ? db.category.findMany({ where: { tenantId, id: { in: catIds } }, select: { id: true, title: true, slug: true } }) : [],
    tagIds.length ? db.tag.findMany({ where: { tenantId, id: { in: tagIds } }, select: { id: true, name: true, slug: true } }) : [],
    fvIds.length
      ? db.facetValue.findMany({ where: { tenantId, id: { in: fvIds } }, select: { id: true, name: true, facet: { select: { name: true } } } })
      : [],
  ]);
  const catBy = new Map(cats.map((c) => [c.id, c]));
  const tagBy = new Map(tags.map((t) => [t.id, t]));
  const fvBy = new Map(fvs.map((v) => [v.id, { id: v.id, name: v.name, facet: v.facet.name }]));
  return queries.map((q) => {
    const category = q.categoryId ? (catBy.get(q.categoryId) ?? null) : null;
    const qTags = q.tagIds.flatMap((id) => (tagBy.has(id) ? [tagBy.get(id)!] : []));
    const facets = q.facetValueIds.flatMap((id) => (fvBy.has(id) ? [fvBy.get(id)!] : []));
    const sp = new URLSearchParams();
    if (q.q) sp.set("q", q.q);
    for (const t of qTags) sp.append("tag", t.slug);
    // `f` = facet value id (the CATALOG-EXTENSIONS agent owns the facet URL param; keep in sync).
    for (const f of facets) sp.append("f", f.id);
    if (q.priceMin !== null) sp.set("min", String(Math.floor(q.priceMin / MINOR_PER_UNIT)));
    if (q.priceMax !== null) sp.set("max", String(Math.ceil(q.priceMax / MINOR_PER_UNIT)));
    const qs = sp.toString();
    const path = category ? categoryHref(category.slug) : SHOP_PATH;
    return { text: q.q, category, tags: qTags, facets, priceMin: q.priceMin, priceMax: q.priceMax, href: qs ? `${path}?${qs}` : path };
  });
}

/** Short label for a search, e.g. "Helmets · Germany · WW2 · “m35”". */
export function summarizeDescription(d: QueryDescription, formatPrice?: (minor: number) => string): string {
  const fmt = formatPrice ?? ((m: number) => String(Math.round(m / MINOR_PER_UNIT)));
  const parts: string[] = [];
  if (d.category) parts.push(d.category.title);
  for (const f of d.facets) parts.push(f.name);
  for (const t of d.tags) parts.push(t.name);
  if (d.text) parts.push(`“${d.text}”`);
  if (d.priceMin !== null && d.priceMax !== null) parts.push(`${fmt(d.priceMin)}–${fmt(d.priceMax)}`);
  else if (d.priceMin !== null) parts.push(`from ${fmt(d.priceMin)}`);
  else if (d.priceMax !== null) parts.push(`up to ${fmt(d.priceMax)}`);
  return parts.length ? parts.join(" · ") : "All new arrivals";
}

/**
 * Suggested "notify me about similar items" query for a (sold / reserved) product: its category plus
 * its facet values. Tags are left out on purpose (they are often item-specific and would make the
 * search too narrow); the visitor can still edit the name. Returns EMPTY_QUERY for unknown products.
 */
export async function suggestedQueryForProduct(tenantId: string, productId: string): Promise<SavedSearchQuery> {
  const p = await db.product.findFirst({
    where: { id: productId, tenantId, status: { in: ["ACTIVE", "RESERVED", "SOLD"] } },
    select: { categoryId: true, productFacetValues: { select: { facetValueId: true }, take: 20 } },
  });
  if (!p) return EMPTY_QUERY;
  const q = normalizeQuery({ categoryId: p.categoryId, facetValueIds: p.productFacetValues.map((v) => v.facetValueId) });
  return isEmptyQuery(q) ? EMPTY_QUERY : q;
}
