import { getSeoScope, notFoundResponse, textResponse } from "@/server/seo/http";
import {
  MAX_PAGES,
  SITEMAP_PAGE_SIZE,
  getIndexableProductCount,
  getIndexableProductsPage,
  getSitemapCategories,
  getSitemapFacetValues,
  getSitemapPages,
  shopCountry,
  type SeoProductRow,
} from "@/server/seo";
import { ARCHIVE_PATH, SHOP_PATH, categoryHref, facetValueHref, flattenTree, getCategoryTree, productHref } from "@/server/storefront-catalog";
import { PRODUCTS_PER_SITEMAP, parseSitemapFile, urlsetXml, type SitemapUrl } from "@/lib/seo/sitemap-xml";

/*
 * /sitemaps/{pages|categories|facets|products-N}.xml — the files listed by /sitemap.xml.
 * Only for live shop hosts; every URL is built from the request's own shop origin and tenant.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const file = parseSitemapFile((await ctx.params).file);
  const scope = await getSeoScope();
  if (!file || scope.kind !== "shop") return notFoundResponse();
  const { shop } = scope;
  const id = shop.tenant.id;
  const abs = (path: string) => new URL(path, shop.origin).toString();
  const archive = shop.settings.catalog.publicArchive;
  let urls: SitemapUrl[];

  switch (file.kind) {
    case "pages": {
      const pages = await getSitemapPages(id);
      urls = [
        // Home redirects to the catalog when content.homeRedirectsToShop is on: list only the target.
        ...(shop.settings.content.homeRedirectsToShop ? [] : [{ loc: abs("/") }]),
        { loc: abs(SHOP_PATH) },
        ...(archive ? [{ loc: abs(ARCHIVE_PATH) }] : []),
        ...pages.map((p) => ({ loc: abs(p.href), lastmod: p.updatedAt })),
      ];
      break;
    }
    case "categories": {
      const [rows, tree] = await Promise.all([getSitemapCategories(id), getCategoryTree(id)]);
      // Only categories visible in the public tree (active up to the root) that list something.
      const live = new Map(flattenTree(tree).map((n) => [n.slug, n.total]));
      urls = rows.filter((c) => (live.get(c.slug) ?? 0) > 0).map((c) => ({ loc: abs(categoryHref(c.slug)), lastmod: c.updatedAt }));
      break;
    }
    case "facets": {
      const values = await getSitemapFacetValues(id);
      urls = values.map((v) => ({ loc: abs(facetValueHref(v.facetSlug, v.valueSlug)), lastmod: v.updatedAt }));
      break;
    }
    case "products": {
      const per = PRODUCTS_PER_SITEMAP / SITEMAP_PAGE_SIZE;
      const first = (file.chunk - 1) * per;
      if (first >= MAX_PAGES) return notFoundResponse();
      const { count } = await getIndexableProductCount(id, archive);
      const last = Math.min(first + per, Math.ceil(count / SITEMAP_PAGE_SIZE), MAX_PAGES);
      if (first >= last && file.chunk > 1) return notFoundResponse();
      const rows: SeoProductRow[] = [];
      // Pages are fetched one by one: each is its own data-cache entry (compliance may shorten a page).
      for (let page = first; page < last; page++) rows.push(...(await getIndexableProductsPage(id, archive, shopCountry(shop), page)));
      urls = rows.map((p) => ({ loc: abs(productHref(p)), lastmod: p.updatedAt, images: p.images.map(abs) }));
      break;
    }
  }
  return textResponse(urlsetXml(urls), "application/xml");
}
