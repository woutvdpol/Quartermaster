import "server-only";
import { db } from "@/server/db";
import { hashToken } from "@/server/auth/tokens";
import { readCartToken } from "@/server/cart/cookie";
import { Prisma } from "@/generated/prisma/client";
import { imageUrl } from "@/server/media/product-images";
import { VARIANT_NAMES, type VariantName } from "@/server/media/images";
import { sourcesFromManifest, type ManifestLike } from "@/lib/media/variants";
import {
  buildValueTree,
  valuePaths,
  type ValueNode,
} from "@/server/facets/tree";
import {
  resolveFacetSelection,
  tokensForValueIds,
  type FacetSelection,
} from "./facet-selection";
import type { ComplianceHide } from "@/server/compliance/resolve";
import {
  catalogWindow,
  facetToken,
  type CatalogParams,
  type CatalogSort,
} from "./params";
import { productHref } from "./urls";
import { priceVisible } from "./sold";
import type {
  CatalogCard,
  CatalogFacets,
  FacetGroup,
  FacetValueOption,
  ProductFacet,
  PublicTaxonomy,
  CatalogPage,
  PublicCategory,
  PublicCategoryNode,
  PublicImage,
  PublicProduct,
  PublicStatus,
  Specification,
} from "./types";

/*
 * Public, tenant-scoped catalog reads for the storefront. Uncached building blocks — pages use the
 * cached wrappers in ./index.ts. Every query filters on an explicit tenantId and on the public
 * visibility predicate; nothing here selects purchasePrice, notes or legacyData.
 *
 * Visibility:
 *   shop     ACTIVE with stock, or RESERVED (shown as "reserved")
 *   archive  SOLD and not archiveHidden (docs/sold-archive.md)
 *   detail   shop ∪ archive (sold items stay reachable as a reference — docs/analysis/03 §8)
 * DRAFT, ARCHIVED and STOLEN are never public.
 */

export type CatalogMode = "shop" | "archive";

// Items on a LIVE fair that hides fair stock (Product.fairHoldId, docs/fair-mode.md) are not listed.
const VISIBLE_SHOP = Prisma.sql`((p.status = 'RESERVED' OR (p.status = 'ACTIVE' AND p.quantity > 0)) AND p."fairHoldId" IS NULL)`;
const VISIBLE_ARCHIVE = Prisma.sql`(p.status = 'SOLD' AND NOT p."archiveHidden")`;

function visibleSql(mode: CatalogMode) {
  return mode === "archive" ? VISIBLE_ARCHIVE : VISIBLE_SHOP;
}

/**
 * The price as the visitor may see it. In the archive only items with `showSoldPrice` have one (NULL
 * otherwise), so price filters, price sorting and the price bounds never reveal a hidden sold price.
 */
function priceSql(mode: CatalogMode) {
  return mode === "archive" ? Prisma.sql`(CASE WHEN p."showSoldPrice" THEN p.price END)` : Prisma.sql`p.price`;
}

// ─── Images ────────────────────────────────────────────────────────────────

type ImageRow = {
  id: string;
  storageKey: string;
  variants: Prisma.JsonValue;
  alt: string | null;
  width: number | null;
  height: number | null;
};
type Manifest = Partial<
  Record<VariantName, { key?: string; dataUrl?: string }>
>;

export function toPublicImage(row: ImageRow): PublicImage {
  const manifest: Manifest =
    row.variants &&
    typeof row.variants === "object" &&
    !Array.isArray(row.variants)
      ? (row.variants as Manifest)
      : {};
  // Unprocessed (e.g. not-yet-migrated) images have no variants: fall back to the original.
  const processed = Boolean(manifest.card?.key);
  const url = (v: VariantName) =>
    manifest[v]?.key
      ? `/uploads/${manifest[v]!.key}`
      : processed
        ? imageUrl(row.storageKey, v)
        : imageUrl(row.storageKey);
  const urls = Object.fromEntries(
    VARIANT_NAMES.map((v) => [v, url(v)]),
  ) as Record<VariantName, string>;
  return {
    id: row.id,
    alt: row.alt,
    width: row.width,
    height: row.height,
    thumb: urls.thumb,
    card: urls.card,
    large: urls.large,
    blur: urls.blur,
    blurDataUrl: manifest.blur?.dataUrl ?? null,
    sources: processed ? sourcesFromManifest(manifest as ManifestLike) : null,
  };
}

const imageSelect = {
  id: true,
  storageKey: true,
  variants: true,
  alt: true,
  width: true,
  height: true,
} as const;
const imageOrder = [
  { sortOrder: "asc" as const },
  { createdAt: "asc" as const },
];

function baseStatus(status: string): PublicStatus {
  if (status === "SOLD") return "sold";
  if (status === "RESERVED") return "reserved";
  return "available";
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ─── Categories ────────────────────────────────────────────────────────────

/**
 * Active category tree with visible-product counts. A category whose ancestor is inactive is hidden
 * too. Ordered by sortOrder, title.
 */
export async function getPublicCategoryTree(
  tenantId: string,
): Promise<PublicCategoryNode[]> {
  const [cats, counts] = await Promise.all([
    db.category.findMany({
      where: { tenantId },
      select: {
        id: true,
        parentId: true,
        title: true,
        slug: true,
        isActive: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    }),
    db.$queryRaw<{ categoryId: string; n: number }[]>`
      SELECT p."categoryId", count(*)::int AS n
      FROM products p
      WHERE p."tenantId" = ${tenantId} AND p."categoryId" IS NOT NULL AND ${VISIBLE_SHOP}
      GROUP BY p."categoryId"`,
  ]);
  const countBy = new Map(counts.map((c) => [c.categoryId, c.n]));
  const nodes = new Map<string, PublicCategoryNode & { isActive: boolean }>();
  for (const c of cats) {
    nodes.set(c.id, {
      id: c.id,
      parentId: c.parentId,
      title: c.title,
      slug: c.slug,
      isActive: c.isActive,
      count: countBy.get(c.id) ?? 0,
      total: 0,
      children: [],
    });
  }
  const roots: (PublicCategoryNode & { isActive: boolean })[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const finish = (
    list: (PublicCategoryNode & { isActive: boolean })[],
  ): PublicCategoryNode[] =>
    list
      .filter((n) => n.isActive)
      .map((n) => {
        const children = finish(
          n.children as (PublicCategoryNode & { isActive: boolean })[],
        );
        const total = n.count + children.reduce((s, c) => s + c.total, 0);
        return {
          id: n.id,
          parentId: n.parentId,
          title: n.title,
          slug: n.slug,
          count: n.count,
          total,
          children,
        };
      });
  return finish(roots);
}

/** Flattens a tree (depth-first). */
export function flattenTree(tree: PublicCategoryNode[]): PublicCategoryNode[] {
  return tree.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** Ids of a category and all its (visible) descendants. */
export function subtreeIds(node: PublicCategoryNode): string[] {
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

/** Root → node path in the public tree, or [] when not found. */
export function categoryPath(
  tree: PublicCategoryNode[],
  id: string,
): PublicCategoryNode[] {
  for (const n of tree) {
    if (n.id === id) return [n];
    const sub = categoryPath(n.children, id);
    if (sub.length) return [n, ...sub];
  }
  return [];
}

export async function getPublicCategoryBySlug(
  tenantId: string,
  slug: string,
): Promise<PublicCategory | null> {
  const c = await db.category.findFirst({
    where: { tenantId, slug, isActive: true },
    select: {
      id: true,
      parentId: true,
      title: true,
      slug: true,
      description: true,
      seoTitle: true,
      seoDescription: true,
    },
  });
  return c;
}

// ─── Listing ───────────────────────────────────────────────────────────────

export type ListScope = {
  mode: CatalogMode;
  /** Restrict to these category ids (a category and its descendants); null = everything. */
  categoryIds: string[] | null;
  /** Minor units per whole currency unit for the min/max price params (100; 1 for JPY). */
  priceUnit?: number;
  /** Visitor-country compliance: products matching this predicate are excluded (src/server/compliance). */
  hide?: ComplianceHide | null;
  /** Facet tokens that are part of the page itself (SEO landing /shop/facet/x/y), ANDed with params.facets. */
  lockedFacets?: string[];
  /**
   * Restrict to these product ids (smart search: the fused result set, src/server/search). Used for
   * facet counts over search results; null/undefined = no restriction.
   */
  ids?: string[] | null;
};

// ─── Facet taxonomy ────────────────────────────────────────────────────────

/** All facets and values of a shop (no counts). Small (tens to hundreds of rows). */
export async function getPublicTaxonomy(
  tenantId: string,
): Promise<PublicTaxonomy> {
  const [facets, values] = await Promise.all([
    db.facet.findMany({
      where: { tenantId },
      select: {
        id: true,
        kind: true,
        name: true,
        slug: true,
        sortOrder: true,
        isFilterable: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.facetValue.findMany({
      where: { tenantId },
      select: {
        id: true,
        facetId: true,
        parentId: true,
        name: true,
        slug: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  return { facets, values };
}

function allTokens(
  scope: ListScope,
  params: Pick<CatalogParams, "facets">,
  tax?: PublicTaxonomy,
  ids: readonly string[] = [],
): string[] {
  return [
    ...new Set([
      ...(scope.lockedFacets ?? []),
      ...params.facets,
      ...(tax ? tokensForValueIds(tax, ids) : []),
    ]),
  ];
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export type FilterParts = Pick<CatalogParams, "q" | "tags" | "min" | "max"> & {
  selection?: FacetSelection[];
};

/** Excludes products hidden for the visitor's country. */
function hideSql(hide: ComplianceHide): Prisma.Sql | null {
  const any: Prisma.Sql[] = [];
  if (hide.categoryIds.length)
    any.push(
      Prisma.sql`coalesce(p."categoryId" = ANY(${hide.categoryIds}::text[]), false)`,
    );
  if (hide.restrictedSymbols) any.push(Prisma.sql`p."restrictedSymbols"`);
  if (hide.ageRestricted) any.push(Prisma.sql`p."ageRestricted"`);
  if (hide.deactivatedWeapons)
    any.push(Prisma.sql`p."requiresDeactivationCert"`);
  return any.length ? Prisma.sql`NOT (${Prisma.join(any, " OR ")})` : null;
}

/**
 * WHERE parts. `omit` leaves out one dimension (for facet counts of that dimension): "category",
 * "price", or a facet id ("facet:<id>"). Exported for the smart search (src/server/search), which
 * applies exactly these visibility/compliance/facet/price filters with `q: null`.
 */
export function whereSql(
  tenantId: string,
  scope: ListScope,
  f: FilterParts,
  omit: "category" | "price" | `facet:${string}` | null = null,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`p."tenantId" = ${tenantId}`,
    visibleSql(scope.mode),
  ];
  if (scope.ids) parts.push(Prisma.sql`p.id = ANY(${scope.ids}::text[])`);
  if (scope.hide) {
    const h = hideSql(scope.hide);
    if (h) parts.push(h);
  }
  for (const sel of f.selection ?? []) {
    if (omit === `facet:${sel.facetId}`) continue;
    // OR within a facet (any selected value or descendant), AND across facets.
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM product_facet_values pfv
      WHERE pfv."productId" = p.id AND pfv."tenantId" = ${tenantId} AND pfv."facetValueId" = ANY(${sel.valueIds}::text[])
    )`);
  }
  if (scope.categoryIds && omit !== "category") {
    parts.push(
      scope.categoryIds.length
        ? Prisma.sql`p."categoryId" = ANY(${scope.categoryIds}::text[])`
        : Prisma.sql`FALSE`,
    );
  }
  if (f.q) {
    const words = f.q.split(" ").filter(Boolean).slice(0, 8);
    for (const raw of words) {
      const word = raw.replace(/^#/, "");
      if (!word) continue;
      const like = `%${escapeLike(word)}%`;
      const or: Prisma.Sql[] = [
        Prisma.sql`p.title ILIKE ${like}`,
        Prisma.sql`p.description ILIKE ${like}`,
        Prisma.sql`p.sku ILIKE ${like}`,
      ];
      if (/^\d{1,9}$/.test(word))
        or.push(Prisma.sql`p."stockCode" = ${Number(word)}`);
      parts.push(Prisma.sql`(${Prisma.join(or, " OR ")})`);
    }
  }
  if (f.tags.length) {
    parts.push(Prisma.sql`(
      SELECT count(DISTINCT t.slug) FROM product_tags pt JOIN tags t ON t.id = pt."tagId"
      WHERE pt."productId" = p.id AND t."tenantId" = ${tenantId} AND t.slug = ANY(${f.tags}::text[])
    ) = ${f.tags.length}`);
  }
  if (omit !== "price") {
    if (f.min !== null)
      parts.push(Prisma.sql`${priceSql(scope.mode)} >= ${f.min * (scope.priceUnit ?? 100)}`);
    if (f.max !== null)
      parts.push(Prisma.sql`${priceSql(scope.mode)} <= ${f.max * (scope.priceUnit ?? 100)}`);
  }
  return Prisma.join(parts, " AND ");
}

const LISTED_AT = Prisma.sql`coalesce(p."publishedAt", p."createdAt")`;

export function orderSql(sort: CatalogSort, mode: CatalogMode): Prisma.Sql {
  if (
    mode === "archive" &&
    (sort === "newest" || sort === "featured" || sort === "updated" || sort === "relevance")
  ) {
    return Prisma.sql`p."soldAt" DESC NULLS LAST, p.id DESC`;
  }
  switch (sort) {
    case "oldest":
      return Prisma.sql`${LISTED_AT} ASC, p.id ASC`;
    case "price_asc":
      return Prisma.sql`${priceSql(mode)} ASC NULLS LAST, p.id ASC`;
    case "price_desc":
      return Prisma.sql`${priceSql(mode)} DESC NULLS LAST, p.id DESC`;
    case "featured":
      return Prisma.sql`p.importance DESC, ${LISTED_AT} DESC, p.id DESC`;
    case "updated":
      return Prisma.sql`p."updatedAt" DESC, p.id DESC`;
    // "relevance" is ordered by the smart search itself (src/server/search); as SQL it means newest.
    case "newest":
    case "relevance":
    default:
      return Prisma.sql`${LISTED_AT} DESC, p.id DESC`;
  }
}

/** Loads card DTOs for ids, keeping the given order. */
export async function loadCards(
  tenantId: string,
  ids: string[],
): Promise<CatalogCard[]> {
  if (!ids.length) return [];
  const rows = await db.product.findMany({
    where: { tenantId, id: { in: ids } },
    select: {
      id: true,
      stockCode: true,
      slug: true,
      title: true,
      price: true,
      status: true,
      onSale: true,
      blurred: true,
      showSoldPrice: true,
      publishedAt: true,
      soldAt: true,
      category: { select: { title: true, slug: true, isActive: true } },
      images: { select: imageSelect, orderBy: imageOrder, take: 1 },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    if (!p) return [];
    return [
      {
        id: p.id,
        stockCode: p.stockCode,
        slug: p.slug,
        href: productHref(p),
        title: p.title,
        // A hidden sold price never leaves the server (cards also feed the JSON search API).
        price: priceVisible(p) ? p.price : 0,
        status: baseStatus(p.status),
        onSale: p.onSale,
        blurred: p.blurred,
        showSoldPrice: p.showSoldPrice,
        publishedAt: iso(p.publishedAt),
        soldAt: iso(p.soldAt),
        category: p.category?.isActive
          ? { title: p.category.title, slug: p.category.slug }
          : null,
        cover: p.images[0] ? toPublicImage(p.images[0]) : null,
      },
    ];
  });
}

/** One page of the catalog (or archive) under the given scope and filters. */
export async function listCatalog(
  tenantId: string,
  scope: ListScope,
  params: CatalogParams,
): Promise<CatalogPage> {
  const needsTax = Boolean(
    scope.lockedFacets?.length ||
    params.facets.length ||
    params.facetValueIds?.length,
  );
  const tax = needsTax ? await getPublicTaxonomy(tenantId) : null;
  const selection = tax
    ? resolveFacetSelection(
        tax,
        allTokens(scope, params, tax, params.facetValueIds ?? []),
      )
    : [];
  const where = whereSql(tenantId, scope, { ...params, selection });
  const { offset, limit } = catalogWindow(params);
  const [idRows, [{ total }]] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM products p WHERE ${where}
      ORDER BY ${orderSql(params.sort, scope.mode)}
      LIMIT ${limit} OFFSET ${offset}`,
    db.$queryRaw<
      { total: number }[]
    >`SELECT count(*)::int AS total FROM products p WHERE ${where}`,
  ]);
  return {
    items: await loadCards(
      tenantId,
      idRows.map((r) => r.id),
    ),
    total,
  };
}

/**
 * Facet value counts (descendant-inclusive, distinct products) under `where`, for the values of
 * `facetIds`. A recursive closure maps every value to itself and its ancestors.
 */
async function facetValueCounts(
  tenantId: string,
  where: Prisma.Sql,
  facetIds: string[],
): Promise<Map<string, number>> {
  if (!facetIds.length) return new Map();
  const rows = await db.$queryRaw<{ valueId: string; n: number }[]>`
    WITH RECURSIVE closure(ancestor, descendant) AS (
      SELECT fv.id, fv.id FROM facet_values fv
      WHERE fv."tenantId" = ${tenantId} AND fv."facetId" = ANY(${facetIds}::text[])
      UNION
      SELECT c.ancestor, fv.id FROM closure c JOIN facet_values fv ON fv."parentId" = c.descendant
    )
    SELECT c.ancestor AS "valueId", count(DISTINCT p.id)::int AS n
    FROM products p
    JOIN product_facet_values pfv ON pfv."productId" = p.id
    JOIN closure c ON c.descendant = pfv."facetValueId"
    WHERE ${where}
    GROUP BY c.ancestor`;
  return new Map(rows.map((r) => [r.valueId, r.n]));
}

/**
 * Facets for the sidebar (GROUP BY / aggregate queries):
 *  - category counts with every filter except the category (so siblings stay visible),
 *  - facet value counts per facet with every filter except that facet's own selection (OR within
 *    a facet), one query for all unselected facets plus one per facet with a selection,
 *  - counts of tags that are not mapped to a facet value, over the current result set,
 *  - price bounds with every filter except price.
 */
export async function getCatalogFacets(
  tenantId: string,
  scope: ListScope,
  params: CatalogParams,
): Promise<CatalogFacets> {
  const tax = await getPublicTaxonomy(tenantId);
  const tokens = allTokens(scope, params, tax, params.facetValueIds ?? []);
  const selection = resolveFacetSelection(tax, tokens);
  const f = { ...params, selection };
  const filterable = tax.facets.filter(
    (fc) => fc.isFilterable && tax.values.some((v) => v.facetId === fc.id),
  );
  const selectedFacetIds = new Set(selection.map((s) => s.facetId));
  const unselected = filterable
    .filter((fc) => !selectedFacetIds.has(fc.id))
    .map((fc) => fc.id);

  const [cats, tags, [price], baseCounts, ...selectedCounts] =
    await Promise.all([
      db.$queryRaw<{ categoryId: string; n: number }[]>`
      SELECT coalesce(p."categoryId", '') AS "categoryId", count(*)::int AS n FROM products p
      WHERE ${whereSql(tenantId, scope, f, "category")}
      GROUP BY 1`,
      db.$queryRaw<{ id: string; name: string; slug: string; n: number }[]>`
      SELECT t.id, t.name, t.slug, count(*)::int AS n
      FROM products p
      JOIN product_tags pt ON pt."productId" = p.id
      JOIN tags t ON t.id = pt."tagId"
      WHERE ${whereSql(tenantId, scope, f)}
        AND NOT (t."legacyId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM facet_values fv WHERE fv."tenantId" = ${tenantId} AND fv."legacyTagId" = t."legacyId"
        ))
      GROUP BY t.id, t.name, t.slug
      ORDER BY n DESC, t.name ASC
      LIMIT 200`,
      db.$queryRaw<{ min: number | null; max: number | null }[]>`
      SELECT min(${priceSql(scope.mode)})::int AS min, max(${priceSql(scope.mode)})::int AS max FROM products p
      WHERE ${whereSql(tenantId, scope, f, "price")}`,
      facetValueCounts(tenantId, whereSql(tenantId, scope, f), unselected),
      ...selection
        .filter((sel) => filterable.some((fc) => fc.id === sel.facetId))
        .map((sel) =>
          facetValueCounts(
            tenantId,
            whereSql(tenantId, scope, f, `facet:${sel.facetId}`),
            [sel.facetId],
          ),
        ),
    ]);
  const counts = new Map<string, number>([
    ...baseCounts,
    ...selectedCounts.flatMap((m) => [...m]),
  ]);
  const selectedTokens = new Set(tokens);

  const facets: FacetGroup[] = filterable.map((fc) => {
    const own = tax.values.filter((v) => v.facetId === fc.id);
    const toOption = (n: ValueNode<(typeof own)[number]>): FacetValueOption => {
      const token = facetToken(fc.slug, n.slug);
      return {
        id: n.id,
        name: n.name,
        slug: n.slug,
        token,
        count: counts.get(n.id) ?? 0,
        selected: selectedTokens.has(token),
        children: n.children.map(toOption),
      };
    };
    return {
      id: fc.id,
      kind: fc.kind,
      name: fc.name,
      slug: fc.slug,
      values: buildValueTree(own).map(toOption),
    };
  });

  return {
    categoryCounts: Object.fromEntries(cats.map((c) => [c.categoryId, c.n])),
    facets,
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      count: t.n,
    })),
    price:
      price && price.min !== null && price.max !== null
        ? { min: price.min, max: price.max }
        : null,
  };
}

/** Facet values linked to a product, grouped per facet (facet order, then value order). */
export async function getProductFacets(
  tenantId: string,
  productId: string,
): Promise<ProductFacet[]> {
  const [tax, links] = await Promise.all([
    getPublicTaxonomy(tenantId),
    db.productFacetValue.findMany({
      where: { tenantId, productId },
      select: { facetValueId: true },
    }),
  ]);
  if (!links.length) return [];
  const linked = new Set(links.map((l) => l.facetValueId));
  return tax.facets.flatMap((fc) => {
    const own = tax.values.filter((v) => v.facetId === fc.id);
    const paths = valuePaths(own);
    const order = new Map(
      flattenIds(buildValueTree(own)).map((vid, i) => [vid, i]),
    );
    const values = own
      .filter((v) => linked.has(v.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((v) => ({
        id: v.id,
        name: v.name,
        slug: v.slug,
        token: facetToken(fc.slug, v.slug),
        path: paths.get(v.id) ?? [v.name],
      }));
    return values.length
      ? [
          {
            facet: {
              id: fc.id,
              kind: fc.kind,
              name: fc.name,
              slug: fc.slug,
              isFilterable: fc.isFilterable,
            },
            values,
          },
        ]
      : [];
  });
}

function flattenIds<T extends { id: string; children: T[] }>(
  nodes: T[],
): string[] {
  return nodes.flatMap((n) => [n.id, ...flattenIds(n.children)]);
}

/** Tag rows (name/slug) for a set of slugs — used for active-filter chips and titles. */
export async function getTagsBySlug(
  tenantId: string,
  slugs: string[],
): Promise<{ id: string; name: string; slug: string }[]> {
  if (!slugs.length) return [];
  return db.tag.findMany({
    where: { tenantId, slug: { in: slugs } },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
}

// ─── Product detail ────────────────────────────────────────────────────────

function parseSpecs(value: Prisma.JsonValue | null): Specification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return [];
    const { label, value: v } = s as Record<string, unknown>;
    if (
      typeof label !== "string" ||
      typeof v !== "string" ||
      !label.trim() ||
      !v.trim()
    )
      return [];
    return [{ label: label.trim(), value: v.trim() }];
  });
}

/** A public product by stock code (for sale, reserved or sold), or null. */
export async function getPublicProduct(
  tenantId: string,
  stockCode: number,
): Promise<PublicProduct | null> {
  const p = await db.product.findFirst({
    where: {
      tenantId,
      stockCode,
      status: { in: ["ACTIVE", "RESERVED", "SOLD"] },
    },
    select: {
      id: true,
      tenantId: true,
      stockCode: true,
      sku: true,
      slug: true,
      title: true,
      description: true,
      specifications: true,
      price: true,
      status: true,
      quantity: true,
      onSale: true,
      weightGrams: true,
      blurred: true,
      ageRestricted: true,
      restrictedSymbols: true,
      requiresDeactivationCert: true,
      acceptsOffers: true,
      publishedAt: true,
      soldAt: true,
      archiveHidden: true,
      showSoldPrice: true,
      fairHoldId: true,
      updatedAt: true,
      seoTitle: true,
      seoDescription: true,
      categoryId: true,
      tags: {
        select: { tag: { select: { id: true, name: true, slug: true } } },
      },
      images: { select: imageSelect, orderBy: imageOrder },
      relatedTo: {
        select: { relatedProductId: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!p) return null;
  // ACTIVE without stock is not purchasable and not listed; treat it like sold-out-but-unsold → hide.
  if (p.status === "ACTIVE" && p.quantity <= 0) return null;

  let path: PublicProduct["categoryPath"] = [];
  const [tree, facets] = await Promise.all([
    p.categoryId ? getPublicCategoryTree(tenantId) : Promise.resolve(null),
    getProductFacets(tenantId, p.id),
  ]);
  if (p.categoryId && tree) {
    path = categoryPath(tree, p.categoryId).map((n) => ({
      id: n.id,
      title: n.title,
      slug: n.slug,
    }));
  }
  return {
    id: p.id,
    tenantId: p.tenantId,
    stockCode: p.stockCode,
    sku: p.sku,
    slug: p.slug,
    href: productHref(p),
    title: p.title,
    description: p.description,
    specifications: parseSpecs(p.specifications),
    price: priceVisible(p) ? p.price : 0,
    // On a fair (held from the shop): reachable via its QR label, but shown as not purchasable.
    status: p.fairHoldId && p.status === "ACTIVE" ? "reserved" : baseStatus(p.status),
    onSale: p.onSale,
    weightGrams: p.weightGrams,
    blurred: p.blurred,
    ageRestricted: p.ageRestricted,
    restrictedSymbols: p.restrictedSymbols,
    requiresDeactivationCert: p.requiresDeactivationCert,
    acceptsOffers: p.acceptsOffers,
    publishedAt: iso(p.publishedAt),
    soldAt: iso(p.soldAt),
    archiveHidden: p.archiveHidden,
    showSoldPrice: p.showSoldPrice,
    updatedAt: p.updatedAt.toISOString(),
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    categoryId: p.categoryId,
    categoryPath: path,
    tags: p.tags.map((t) => t.tag).sort((a, b) => a.name.localeCompare(b.name)),
    facets,
    images: p.images.map(toPublicImage),
    relatedIds: p.relatedTo.map((r) => r.relatedProductId),
  };
}

/**
 * Related products: manual relations first (in their order), then the newest items of the same
 * category, then items sharing a tag. Only for-sale / reserved items; never the product itself.
 */
export async function getRelatedProducts(
  tenantId: string,
  product: {
    id: string;
    relatedIds: string[];
    categoryId: string | null;
    tagIds: string[];
  },
  limit = 4,
): Promise<CatalogCard[]> {
  const picked: string[] = [];
  const take = async (sql: Prisma.Sql) => {
    if (picked.length >= limit) return;
    const exclude = [product.id, ...picked];
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM products p
      WHERE p."tenantId" = ${tenantId} AND ${VISIBLE_SHOP} AND NOT (p.id = ANY(${exclude}::text[])) AND ${sql}
      ORDER BY ${LISTED_AT} DESC, p.id DESC
      LIMIT ${limit - picked.length}`;
    picked.push(...rows.map((r) => r.id));
  };
  if (product.relatedIds.length) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM products p
      WHERE p."tenantId" = ${tenantId} AND ${VISIBLE_SHOP} AND p.id = ANY(${product.relatedIds}::text[]) AND p.id <> ${product.id}`;
    const ok = new Set(rows.map((r) => r.id));
    picked.push(
      ...product.relatedIds.filter((id) => ok.has(id)).slice(0, limit),
    );
  }
  if (product.categoryId)
    await take(Prisma.sql`p."categoryId" = ${product.categoryId}`);
  if (product.tagIds.length) {
    await take(
      Prisma.sql`EXISTS (SELECT 1 FROM product_tags pt WHERE pt."productId" = p.id AND pt."tagId" = ANY(${product.tagIds}::text[]))`,
    );
  }
  return loadCards(tenantId, picked);
}

// ─── Per-request (never cached) ────────────────────────────────────────────

/** Hash of the visitor's cart cookie, or null (no cart, or called outside a request). */
async function ownCartTokenHash(): Promise<string | null> {
  try {
    const token = await readCartToken();
    return token ? hashToken(token) : null;
  } catch {
    return null;
  }
}

/**
 * Ids among `productIds` currently held in SOMEONE ELSE'S cart (live reservation: ACTIVE and not
 * expired). Items in the visitor's own cart are not "reserved" for them. Time-dependent, so it is
 * read per request on top of the cached catalog data.
 */
export async function liveReservedIds(
  tenantId: string,
  productIds: string[],
): Promise<Set<string>> {
  if (!productIds.length) return new Set();
  const ownHash = await ownCartTokenHash();
  const rows = await db.reservation.findMany({
    where: {
      tenantId,
      productId: { in: productIds },
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
      ...(ownHash ? { NOT: { cart: { is: { tokenHash: ownHash } } } } : {}),
    },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

/** Ids among `productIds` held by the visitor's OWN cart right now (product page: "In your cart"). */
export async function ownReservedIds(
  tenantId: string,
  productIds: string[],
): Promise<Set<string>> {
  const ownHash = productIds.length ? await ownCartTokenHash() : null;
  if (!ownHash) return new Set();
  const rows = await db.reservation.findMany({
    where: {
      tenantId,
      productId: { in: productIds },
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
      cart: { is: { tokenHash: ownHash } },
    },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

/** Applies live reservations to card/product statuses ("available" → "reserved"). */
export function withLiveStatus<T extends { id: string; status: PublicStatus }>(
  items: T[],
  reserved: Set<string>,
): T[] {
  return items.map((i) =>
    i.status === "available" && reserved.has(i.id)
      ? { ...i, status: "reserved" as const }
      : i,
  );
}
