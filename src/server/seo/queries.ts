import "server-only";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { evaluateCompliance, getCompiledRules } from "@/server/compliance/resolve";
import { contentPageHref } from "@/server/content/rules";
import { markdownToPlainText } from "@/server/content/markdown";
import { listCategoriesForSitemap, listFacetValuesForSitemap } from "@/server/storefront/products";
import { toPublicImage } from "@/server/storefront-catalog/queries";

/*
 * Uncached reads behind sitemaps, the merchant feed and llms.txt (cached wrappers: ./index.ts).
 * Every query filters on an explicit tenantId. Results are JSON-safe (ISO date strings).
 *
 * Indexable product = public (ACTIVE with stock, RESERVED, and SOLD only with the public archive and
 * not archiveHidden — docs/sold-archive.md),
 * not sensitive (Product.blurred: guests get a login wall, so search engines would too) and not hidden
 * by a compliance rule in the shop's own country. Photos blurred by a rule there are left out.
 */

/** Rows per cached page (each page is one data-cache entry; Next skips entries over 2 MB). */
export const SITEMAP_PAGE_SIZE = 2_000;
export const FEED_PAGE_SIZE = 400;

export type SeoProductRow = {
  stockCode: number;
  slug: string;
  title: string;
  updatedAt: string;
  /** Absolute paths (/uploads/…) of the 2000w variants, primary first. */
  images: string[];
};

export type FeedProductRow = SeoProductRow & {
  description: string;
  price: number;
  categoryId: string | null;
  weightGrams: number;
  brand: string | null;
};

const imageSelect = { id: true, storageKey: true, variants: true, alt: true, width: true, height: true } as const;
const imageOrder = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

function visibleWhere(tenantId: string, includeSold: boolean): Prisma.ProductWhereInput {
  return {
    tenantId,
    blurred: false,
    // fairHoldId: on a LIVE fair that hides fair stock (docs/fair-mode.md).
    OR: [{ status: "ACTIVE", quantity: { gt: 0 }, fairHoldId: null }, { status: "RESERVED" }, ...(includeSold ? [{ status: "SOLD" as const, archiveHidden: false }] : [])],
  };
}

const complianceSelect = { id: true, categoryId: true, restrictedSymbols: true, ageRestricted: true, requiresDeactivationCert: true } as const;

/** Applies the shop-country compliance rules: drops hidden items, strips images of blurred ones. */
async function withCompliance<T extends { images: string[] }, R extends { id: string; categoryId: string | null; restrictedSymbols: boolean; ageRestricted: boolean; requiresDeactivationCert: boolean }>(
  tenantId: string,
  country: string,
  rows: R[],
  map: (r: R) => T,
): Promise<T[]> {
  const rules = country ? await getCompiledRules(tenantId) : [];
  return rows.flatMap((r) => {
    const verdict = evaluateCompliance(rules, r, country || null);
    if (verdict.hidden) return [];
    const out = map(r);
    return [verdict.blurred ? { ...out, images: [] } : out];
  });
}

export async function countIndexableProducts(tenantId: string, includeSold: boolean): Promise<{ count: number; lastmod: string | null }> {
  const agg = await db.product.aggregate({ where: visibleWhere(tenantId, includeSold), _count: { _all: true }, _max: { updatedAt: true } });
  return { count: agg._count._all, lastmod: agg._max.updatedAt?.toISOString() ?? null };
}

/** One page of indexable products (newest stock codes first) for the product sitemaps. */
export async function listIndexableProducts(tenantId: string, includeSold: boolean, country: string, page: number): Promise<SeoProductRow[]> {
  const rows = await db.product.findMany({
    where: visibleWhere(tenantId, includeSold),
    select: { ...complianceSelect, stockCode: true, slug: true, title: true, updatedAt: true, images: { select: imageSelect, orderBy: imageOrder, take: 10 } },
    orderBy: { stockCode: "desc" },
    skip: page * SITEMAP_PAGE_SIZE,
    take: SITEMAP_PAGE_SIZE,
  });
  return withCompliance(tenantId, country, rows, (r) => ({
    stockCode: r.stockCode,
    slug: r.slug,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
    images: r.images.map((i) => toPublicImage(i).large),
  }));
}

/** Buyable items for the merchant feed (see src/lib/seo/merchant-feed.ts for the exclusions). */
function feedWhere(tenantId: string): Prisma.ProductWhereInput {
  return {
    tenantId,
    status: "ACTIVE",
    quantity: { gt: 0 },
    fairHoldId: null, // not buyable while on a fair (docs/fair-mode.md)
    blurred: false,
    ageRestricted: false,
    restrictedSymbols: false,
    requiresDeactivationCert: false,
    images: { some: {} },
  };
}

export async function countFeedProducts(tenantId: string): Promise<number> {
  return db.product.count({ where: feedWhere(tenantId) });
}

export async function listFeedProducts(tenantId: string, country: string, page: number): Promise<FeedProductRow[]> {
  const rows = await db.product.findMany({
    where: feedWhere(tenantId),
    select: {
      ...complianceSelect,
      stockCode: true,
      slug: true,
      title: true,
      description: true,
      price: true,
      weightGrams: true,
      updatedAt: true,
      images: { select: imageSelect, orderBy: imageOrder, take: 11 },
      productFacetValues: {
        where: { facetValue: { facet: { kind: "MAKER" } } },
        select: { facetValue: { select: { name: true } } },
        take: 1,
      },
    },
    orderBy: { stockCode: "desc" },
    skip: page * FEED_PAGE_SIZE,
    take: FEED_PAGE_SIZE,
  });
  const out = await withCompliance(tenantId, country, rows, (r) => ({
    stockCode: r.stockCode,
    slug: r.slug,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
    images: r.images.map((i) => toPublicImage(i).large),
    description: r.description ? markdownToPlainText(r.description).slice(0, 5000) : "",
    price: r.price,
    categoryId: r.categoryId,
    weightGrams: r.weightGrams,
    brand: r.productFacetValues[0]?.facetValue.name ?? null,
  }));
  // Merchant Center rejects items without an image (a blur rule may have removed them).
  return out.filter((r) => r.images.length > 0);
}

/** Published CMS pages except HOME. */
export async function listSitemapPages(tenantId: string): Promise<{ href: string; updatedAt: string }[]> {
  const rows = await db.contentPage.findMany({
    where: { tenantId, publishedAt: { not: null, lte: new Date() }, NOT: { systemKey: "HOME" } },
    select: { slug: true, systemKey: true, updatedAt: true },
    orderBy: { slug: "asc" },
  });
  return rows.map((r) => ({ href: contentPageHref(r), updatedAt: r.updatedAt.toISOString() }));
}

export async function listSitemapCategories(tenantId: string): Promise<{ slug: string; updatedAt: string }[]> {
  const rows = await listCategoriesForSitemap(tenantId);
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
}

/** Facet landing pages with at least one item for sale (landing pages list the for-sale catalog). */
export async function listSitemapFacetValues(tenantId: string): Promise<{ facetSlug: string; valueSlug: string; updatedAt: string }[]> {
  const rows = await listFacetValuesForSitemap(tenantId, false);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

/** Does any public product of the shop have provenance or a certificate? (llms.txt wording) */
export async function hasPublicProvenance(tenantId: string): Promise<boolean> {
  const hit = await db.product.findFirst({
    where: { tenantId, status: { in: ["ACTIVE", "RESERVED", "SOLD"] }, OR: [{ provenance: { not: null } }, { certificates: { some: { revokedAt: null } } }] },
    select: { id: true },
  });
  return hit !== null;
}

/** Category descriptions as plain text (llms-full.txt), by category id. */
export async function listCategoryDescriptions(tenantId: string): Promise<Record<string, string>> {
  const rows = await db.category.findMany({ where: { tenantId, isActive: true, description: { not: null } }, select: { id: true, description: true } });
  return Object.fromEntries(rows.flatMap((r) => (r.description?.trim() ? [[r.id, markdownToPlainText(r.description)]] : [])));
}
