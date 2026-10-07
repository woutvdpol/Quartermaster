import { contentPageHref } from "../../../src/server/content/rules";
import { ETL_MARK, type EtlContext } from "../context";
import { emptyUrlMaps, newTagHref, type UrlMaps } from "../transforms/urls";

/** Legacy ShopPageEnum values with a public page (`/{value}` in Concept500). */
export const LEGACY_CONTENT_PAGES = ["TERMS", "PRIVACY", "CONTACT", "ABOUT", "NEWS", "EVENTS", "LINKS"] as const;
export const SYSTEM_KEY_PAGES = new Set(["TERMS", "PRIVACY", "CONTACT", "ABOUT"]);

/**
 * Old → new URL lookup tables, rebuilt from the target DB + legacy rows (so the content and redirect
 * steps also work with --only).
 */
export async function loadUrlMaps(ctx: EtlContext): Promise<UrlMaps> {
  const { tx, tenantId } = ctx;
  const maps = emptyUrlMaps();

  const products = await tx.product.findMany({
    where: { tenantId, legacyData: { path: ["etl"], equals: ETL_MARK } },
    select: { stockCode: true, slug: true, legacyData: true },
  });
  for (const p of products) {
    maps.products.set(p.stockCode, p.slug);
    const legacySlug = (p.legacyData as Record<string, unknown> | null)?.legacySlug;
    if (typeof legacySlug === "string") maps.legacyProductSlugs.set(p.stockCode, legacySlug);
  }

  const categories = new Map(
    (await tx.category.findMany({ where: { tenantId, legacyId: { not: null } }, select: { legacyId: true, slug: true } })).map((c) => [c.legacyId!, c.slug]),
  );
  for (const c of await ctx.legacy.read("categories")) {
    const slug = categories.get(c.id);
    if (slug && c.slug) maps.categories.set(c.slug, slug);
  }

  const tags = new Map((await tx.tag.findMany({ where: { tenantId, legacyId: { not: null } }, select: { legacyId: true, slug: true } })).map((t) => [t.legacyId!, t.slug]));
  const facetValues = new Map(
    (
      await tx.facetValue.findMany({ where: { tenantId, legacyTagId: { not: null } }, select: { legacyTagId: true, slug: true, facet: { select: { slug: true } } } })
    ).map((v) => [v.legacyTagId!, { facetSlug: v.facet.slug, valueSlug: v.slug }]),
  );
  for (const t of await ctx.legacy.read("tags")) {
    const slug = tags.get(t.id);
    if (slug) maps.tags.set(t.name, newTagHref(slug, facetValues.get(t.id) ?? null));
  }

  const pages = await tx.contentPage.findMany({ where: { tenantId }, select: { slug: true, systemKey: true, legacyId: true } });
  const byLegacy = new Map(pages.filter((p) => p.legacyId !== null).map((p) => [p.legacyId!, p]));
  for (const cp of await ctx.legacy.read("content_pages")) {
    const page = byLegacy.get(cp.id);
    if (page) maps.cmsPages.set(cp.url.replace(/^\/+|\/+$/g, ""), contentPageHref(page));
  }
  for (const key of LEGACY_CONTENT_PAGES) {
    const page = SYSTEM_KEY_PAGES.has(key) ? pages.find((p) => p.systemKey === key) : pages.find((p) => p.slug === key.toLowerCase() && !p.systemKey);
    if (page) maps.contentPages.set(key.toLowerCase(), contentPageHref(page));
  }
  return maps;
}
