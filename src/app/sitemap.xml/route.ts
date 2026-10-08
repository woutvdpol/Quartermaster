import { getSeoScope, notFoundResponse, textResponse } from "@/server/seo/http";
import { getIndexableProductCount, getSitemapCategories, getSitemapFacetValues, getSitemapPages } from "@/server/seo";
import { PRODUCTS_PER_SITEMAP, latest, sitemapFileName, sitemapIndexXml, urlsetXml, type SitemapRef } from "@/lib/seo/sitemap-xml";

/*
 * /sitemap.xml per host (replaces the old src/app/sitemap.ts, which could not produce an index):
 *  - shop host:   sitemap index → /sitemaps/{pages,categories,facets,products-N}.xml
 *  - platform:    a small urlset (landing + application page)
 *  - coming soon: an empty urlset (robots.txt disallows everything anyway)
 * docs/seo-geo.md §Sitemaps.
 */
export async function GET() {
  const scope = await getSeoScope();
  if (scope.kind === "none") return notFoundResponse();
  if (scope.kind === "closed") return textResponse(urlsetXml([]), "application/xml");
  if (scope.kind === "platform") {
    return textResponse(urlsetXml([{ loc: `${scope.origin}/` }, { loc: `${scope.origin}/apply` }]), "application/xml");
  }

  const { shop } = scope;
  const id = shop.tenant.id;
  const [pages, categories, facets, products] = await Promise.all([
    getSitemapPages(id),
    getSitemapCategories(id),
    getSitemapFacetValues(id),
    getIndexableProductCount(id, shop.settings.catalog.publicArchive),
  ]);
  const at = (name: string) => `${shop.origin}/sitemaps/${name}`;
  const refs: SitemapRef[] = [
    { loc: at(sitemapFileName({ kind: "pages" })), lastmod: latest([...pages.map((p) => p.updatedAt), products.lastmod]) },
    { loc: at(sitemapFileName({ kind: "categories" })), lastmod: latest([...categories.map((c) => c.updatedAt), products.lastmod]) },
  ];
  if (facets.length) refs.push({ loc: at(sitemapFileName({ kind: "facets" })), lastmod: latest([...facets.map((f) => f.updatedAt), products.lastmod]) });
  const chunks = Math.ceil(products.count / PRODUCTS_PER_SITEMAP);
  for (let n = 1; n <= chunks; n++) refs.push({ loc: at(sitemapFileName({ kind: "products", chunk: n })), lastmod: products.lastmod });
  return textResponse(sitemapIndexXml(refs), "application/xml");
}
