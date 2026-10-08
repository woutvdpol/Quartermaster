import "server-only";
import type { ShopContext } from "@/server/storefront/context";
import { getLegalLinks } from "@/server/storefront/content";
import { getNewItems } from "@/server/storefront/products";
import { categoryHref, facetValueHref, getCategoryTree, getTaxonomy, productHref } from "@/server/storefront-catalog";
import type { PublicCategoryNode } from "@/server/storefront-catalog/types";
import type { LlmsCategory, LlmsInput } from "@/lib/seo/llms";
import { returnsSummary } from "@/lib/seo/markdown-alternate";
import { getCategoryDescriptions, getHasPublicProvenance, getSitemapFacetValues, shopDescription } from "./index";

/** Assembles the llms.txt input for a live shop from cached reads only. */
export async function loadLlmsInput(shop: ShopContext, full: boolean): Promise<LlmsInput> {
  const id = shop.tenant.id;
  const [tree, legal, hasProvenance, descriptions, facetValues, taxonomy, latest] = await Promise.all([
    getCategoryTree(id),
    getLegalLinks(id),
    getHasPublicProvenance(id),
    full ? getCategoryDescriptions(id) : Promise.resolve({} as Record<string, string>),
    full ? getSitemapFacetValues(id) : Promise.resolve([]),
    full ? getTaxonomy(id) : Promise.resolve(null),
    full ? getNewItems(id, 48) : Promise.resolve([]),
  ]);

  const toCategory = (n: PublicCategoryNode): LlmsCategory => ({
    title: n.title,
    href: categoryHref(n.slug),
    count: n.total,
    description: descriptions[n.id] ?? null,
    children: n.children.filter((c) => c.total > 0).map(toCategory),
  });

  // Facet landing pages grouped per facet (only values with items for sale), in taxonomy order.
  const facets = taxonomy
    ? taxonomy.facets
        .filter((f) => f.isFilterable)
        .map((f) => ({
          name: f.name,
          values: taxonomy.values
            .filter((v) => v.facetId === f.id && facetValues.some((fv) => fv.facetSlug === f.slug && fv.valueSlug === v.slug))
            .map((v) => ({ title: v.name, href: facetValueHref(f.slug, v.slug) })),
        }))
        .filter((f) => f.values.length)
    : [];

  const { general } = shop.settings;
  return {
    shop: {
      name: shop.shopName,
      origin: shop.origin,
      description: shopDescription(shop),
      currency: shop.tenant.currency,
      country: general.address.country,
      city: general.address.city,
      email: general.contactEmail,
      phone: general.phone,
    },
    hasArchive: shop.settings.catalog.publicArchive,
    hasProvenance,
    policies: legal.map((l) => ({ title: l.label, href: l.href, note: `Markdown: ${new URL(`${l.href}.md`, shop.origin).toString()}` })),
    categories: tree.filter((n) => n.total > 0).map(toCategory),
    facets,
    latest: latest.filter((p) => !p.blurred).map((p) => ({ title: p.title, href: productHref(p), stockCode: p.stockCode, price: p.price })),
    returnsLine: returnsSummary(shop.settings.legal.returns),
  };
}
