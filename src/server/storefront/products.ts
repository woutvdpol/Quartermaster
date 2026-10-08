import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { imageUrl } from "@/server/media/product-images";
import { sourcesFromManifest, type ManifestLike } from "@/lib/media/variants";
import { categoryHref } from "@/server/content/rules";
import type { ProductAvailability, ProductCardData, ShopImage } from "@/components/shop/ui/types";
import { shopCache } from "./cache";

/*
 * Public product reads shared by the home page blocks, sitemap and (optionally) other shop areas.
 * Rules: only ACTIVE/RESERVED/SOLD products are ever public (never DRAFT/ARCHIVED/STOLEN); no
 * purchase prices, notes or legacyData leave this module; sensitive (`blurred`) products are
 * "locked" for guests when legal.blurSensitiveForGuests is on.
 */

/** Prisma select for everything a product card needs (nothing internal). */
export const productCardSelect = {
  id: true,
  stockCode: true,
  slug: true,
  title: true,
  price: true,
  status: true,
  onSale: true,
  blurred: true,
  quantity: true,
  publishedAt: true,
  category: { select: { title: true } },
  images: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 1,
    select: { storageKey: true, variants: true, alt: true, width: true, height: true },
  },
} satisfies Prisma.ProductSelect;

export type ProductCardRow = Prisma.ProductGetPayload<{ select: typeof productCardSelect }>;

/** Cache-safe version of a card row (publishedAt as ISO string). */
export type ProductCardRowJson = Omit<ProductCardRow, "publishedAt"> & { publishedAt: string | null };

export const PUBLIC_PRODUCT_STATUSES = ["ACTIVE", "RESERVED", "SOLD"] as const;

export function productHref(p: { stockCode: number; slug: string }): string {
  return `/product/${p.stockCode}/${p.slug}`;
}
export { categoryHref };

type ImageRow = ProductCardRow["images"][number];

function manifestEntry(variants: unknown, name: string): { key?: string; dataUrl?: string; width?: number } | null {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return null;
  const e = (variants as Record<string, unknown>)[name];
  return e && typeof e === "object" ? (e as { key?: string; dataUrl?: string; width?: number }) : null;
}

/** Card image: card (800w) as src, thumb/card/large in srcSet, inline blur placeholder. */
export function toShopImage(img: ImageRow, fallbackAlt: string): ShopImage {
  const url = (v: "thumb" | "card" | "large") => {
    const key = manifestEntry(img.variants, v)?.key;
    return key ? `/uploads/${key}` : imageUrl(img.storageKey, v);
  };
  const processed = !!manifestEntry(img.variants, "card");
  return {
    src: processed ? url("card") : imageUrl(img.storageKey),
    srcSet: processed ? `${url("thumb")} 320w, ${url("card")} 800w, ${url("large")} 2000w` : undefined,
    sources: processed ? sourcesFromManifest(img.variants as ManifestLike) : null,
    blurDataUrl: manifestEntry(img.variants, "blur")?.dataUrl ?? null,
    alt: img.alt ?? fallbackAlt,
    width: img.width,
    height: img.height,
  };
}

export type CardOptions = {
  currency: string;
  /** Signed-in customer/owner of this shop. */
  viewerSignedIn: boolean;
  /** legal.blurSensitiveForGuests */
  blurSensitiveForGuests: boolean;
  /** catalog.showPriceWhenSold */
  showPriceWhenSold: boolean;
  /** Ids with a live (unexpired ACTIVE) reservation — see `liveReservedIds`. */
  reservedIds?: ReadonlySet<string>;
};

export function availabilityOf(p: { id: string; status: string; quantity: number }, reservedIds?: ReadonlySet<string>): ProductAvailability {
  if (p.status === "SOLD" || p.quantity <= 0) return "sold";
  if (p.status === "RESERVED" || reservedIds?.has(p.id)) return "reserved";
  return "available";
}

/** Maps a card row to the client-safe ProductCardData. */
export function toProductCardData(p: ProductCardRow | ProductCardRowJson, opts: CardOptions): ProductCardData {
  const availability = availabilityOf(p, opts.reservedIds);
  const locked = p.blurred && opts.blurSensitiveForGuests && !opts.viewerSignedIn;
  const img = p.images[0];
  let image: ShopImage | null = img ? toShopImage(img, p.title) : null;
  if (image && locked) image = { src: "", blurDataUrl: image.blurDataUrl, alt: "" }; // never leak the real URL
  return {
    id: p.id,
    stockCode: p.stockCode,
    title: p.title,
    href: productHref(p),
    priceCents: p.price,
    currency: opts.currency,
    availability,
    showPrice: availability !== "sold" || opts.showPriceWhenSold,
    onSale: p.onSale,
    locked,
    image,
    eyebrow: p.category?.title ?? null,
  };
}

function toJson(rows: ProductCardRow[]): ProductCardRowJson[] {
  return rows.map((r) => ({ ...r, publishedAt: r.publishedAt?.toISOString() ?? null }));
}

/** Product ids among `ids` with a live reservation (not cached: changes every few minutes). */
export async function liveReservedIds(tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.reservation.findMany({
    where: { tenantId, productId: { in: ids }, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

/** Latest ACTIVE products (newest listing first). Uncached; see `getNewItems`. */
export async function queryNewItems(tenantId: string, count: number): Promise<ProductCardRowJson[]> {
  const rows = await db.product.findMany({
    where: { tenantId, status: "ACTIVE", quantity: { gt: 0 } },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: Math.min(Math.max(count, 1), 48),
    select: productCardSelect,
  });
  return toJson(rows);
}
export const getNewItems = shopCache("new-items", "catalog", queryNewItems);

/** Public products by id (for TEXT_PRODUCT), in the given order; non-public ids are dropped. */
export async function queryProductsByIds(tenantId: string, ids: string[]): Promise<ProductCardRowJson[]> {
  if (!ids.length) return [];
  const rows = await db.product.findMany({
    where: { tenantId, id: { in: ids }, status: { in: [...PUBLIC_PRODUCT_STATUSES] } },
    select: productCardSelect,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return toJson(ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
}
export const getProductsByIds = shopCache("products-by-ids", "catalog", queryProductsByIds);

export type CategoryTile = { id: string; title: string; href: string; productCount: number; image: ShopImage | null };

/**
 * Category tiles: the chosen ids (in that order) or, when empty, all active top-level categories.
 * Count and image cover the category and all its subcategories; the image is the cover of the newest
 * public non-sensitive product in that subtree (categories have no image of their own).
 */
export async function queryCategoryTiles(tenantId: string, ids: string[]): Promise<CategoryTile[]> {
  // All active categories of the shop (a small table): tiles count and picture their whole subtree,
  // since products usually sit in subcategories ("Helmets" → "Steel helmets").
  const all = await db.category.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    select: { id: true, parentId: true, title: true, slug: true },
  });
  const children = new Map<string, string[]>();
  for (const c of all) if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
  const subtree = (id: string): string[] => {
    const out: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (out.includes(cur)) continue;
      out.push(cur);
      stack.push(...(children.get(cur) ?? []));
    }
    return out;
  };
  const cats = ids.length ? ids.flatMap((id) => all.filter((c) => c.id === id)) : all.filter((c) => c.parentId === null);
  const counts = await db.product.groupBy({ by: ["categoryId"], where: { tenantId, status: "ACTIVE" }, _count: { _all: true } });
  const countBy = new Map(counts.map((r) => [r.categoryId, r._count._all]));
  return Promise.all(
    cats.map(async (c) => {
      const tree = subtree(c.id);
      const p = await db.product.findFirst({
        where: { tenantId, categoryId: { in: tree }, status: { in: ["ACTIVE", "SOLD"] }, blurred: false, images: { some: {} } },
        orderBy: [{ status: "asc" }, { publishedAt: { sort: "desc", nulls: "last" } }],
        select: { title: true, images: productCardSelect.images },
      });
      return {
        id: c.id,
        title: c.title,
        href: categoryHref(c.slug),
        productCount: tree.reduce((n, id) => n + (countBy.get(id) ?? 0), 0),
        image: p?.images[0] ? toShopImage(p.images[0], c.title) : null,
      };
    }),
  );
}
export const getCategoryTiles = shopCache("category-tiles", "catalog", queryCategoryTiles);

/**
 * Facet landing pages (/shop/facet/{facet}/{value}) worth indexing: values of filterable facets with
 * at least one visible product — assigned to the value itself or to a descendant value (the landing
 * page includes the subtree). Sensitive (`blurred`) products are skipped: guests cannot open them.
 */
export async function listFacetValuesForSitemap(tenantId: string, includeSold: boolean) {
  const [values, used] = await Promise.all([
    db.facetValue.findMany({
      where: { tenantId, facet: { isFilterable: true } },
      select: { id: true, parentId: true, slug: true, updatedAt: true, facet: { select: { slug: true } } },
    }),
    db.productFacetValue.findMany({
      where: {
        tenantId,
        product: { blurred: false, status: { in: includeSold ? ["ACTIVE", "RESERVED", "SOLD"] : ["ACTIVE", "RESERVED"] } },
      },
      select: { facetValueId: true },
      distinct: ["facetValueId"],
    }),
  ]);
  const byId = new Map(values.map((v) => [v.id, v]));
  const keep = new Set<string>();
  for (const { facetValueId } of used) {
    // Walk up: a value with products makes its ancestors' landing pages non-empty too.
    for (let v = byId.get(facetValueId), guard = 0; v && !keep.has(v.id) && guard < 50; v = v.parentId ? byId.get(v.parentId) : undefined, guard++) {
      keep.add(v.id);
    }
  }
  return values.filter((v) => keep.has(v.id)).map((v) => ({ facetSlug: v.facet.slug, valueSlug: v.slug, updatedAt: v.updatedAt }));
}

export async function listCategoriesForSitemap(tenantId: string) {
  return db.category.findMany({ where: { tenantId, isActive: true }, select: { slug: true, updatedAt: true } });
}
