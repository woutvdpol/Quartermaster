import type { MetadataRoute } from "next";
import { getShopContext } from "@/server/storefront/context";
import { listPublishedPagesForSitemap } from "@/server/storefront/content";
import { categoryHref, listCategoriesForSitemap, listFacetValuesForSitemap, listProductsForSitemap, productHref } from "@/server/storefront/products";
import { facetValueHref } from "@/server/storefront-catalog/urls";

/*
 * Per-host sitemap: the shop of the request host (headers() → rendered per request). The platform
 * host and unknown hosts get an empty sitemap. Sensitive (blurred) products are left out because
 * guests cannot open them; sold items only when the public archive is on.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const shop = await getShopContext();
  if (!shop) return [];
  const id = shop.tenant.id;
  const abs = (path: string) => new URL(path, shop.origin).toString();
  const [pages, categories, products, facetValues] = await Promise.all([
    listPublishedPagesForSitemap(id),
    listCategoriesForSitemap(id),
    listProductsForSitemap(id, shop.settings.catalog.publicArchive),
    // Landing pages list the shop (for-sale) catalog, so sold-only values would be empty pages.
    listFacetValuesForSitemap(id, false),
  ]);
  return [
    { url: abs("/"), changeFrequency: "daily", priority: 1 },
    { url: abs("/shop"), changeFrequency: "hourly", priority: 0.9 },
    ...pages.map((p) => ({ url: abs(p.href), lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.4 })),
    ...categories.map((c) => ({ url: abs(categoryHref(c.slug)), lastModified: c.updatedAt, changeFrequency: "daily" as const, priority: 0.7 })),
    ...facetValues.map((v) => ({ url: abs(facetValueHref(v.facetSlug, v.valueSlug)), lastModified: v.updatedAt, changeFrequency: "daily" as const, priority: 0.6 })),
    ...products.map((p) => ({ url: abs(productHref(p)), lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
