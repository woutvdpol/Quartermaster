import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireShop } from "@/server/storefront/context";
import { CatalogView, defaultSortFor } from "@/components/shop/catalog/CatalogView";
import { catalogCopy as copy } from "@/components/shop/catalog/_copy";
import { catalogMetadata } from "@/components/shop/catalog/metadata";
import { valuePaths } from "@/server/facets/tree";
import { SHOP_PATH, facetToken, facetValueHref, getTaxonomy, parseCatalogParams } from "@/server/storefront-catalog";

type Props = PageProps<"/shop/facet/[facetSlug]/[valueSlug]">;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The facet + value of the landing page, or 404 (unknown, or the facet is not filterable). */
async function loadValue(tenantId: string, rawFacet: string, rawValue: string) {
  const facetSlug = decodeURIComponent(rawFacet).toLowerCase();
  const valueSlug = decodeURIComponent(rawValue).toLowerCase();
  if (!SLUG.test(facetSlug) || !SLUG.test(valueSlug)) notFound();
  const tax = await getTaxonomy(tenantId);
  const facet = tax.facets.find((f) => f.slug === facetSlug && f.isFilterable);
  const own = facet ? tax.values.filter((v) => v.facetId === facet.id) : [];
  const value = own.find((v) => v.slug === valueSlug);
  if (!facet || !value) notFound();
  const path = valuePaths(own).get(value.id) ?? [value.name];
  return { facet, value, path, token: facetToken(facet.slug, value.slug) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const shop = await requireShop();
  const { facetSlug, valueSlug } = await params;
  const { facet, value, path } = await loadValue(shop.tenant.id, facetSlug, valueSlug);
  const query = parseCatalogParams(await searchParams, defaultSortFor(shop, "shop"));
  return catalogMetadata({
    path: facetValueHref(facet.slug, value.slug),
    params: query,
    title: copy.facet.title(path.join(" › ")),
    description: copy.facet.metaDescription(facet.name, path.join(" › "), shop.shopName),
  });
}

/** SEO landing page for one facet value, e.g. /shop/facet/period/ww2 — the catalog with that value fixed. */
export default async function FacetValuePage({ params, searchParams }: Props) {
  const shop = await requireShop();
  const { facetSlug, valueSlug } = await params;
  const { facet, value, path, token } = await loadValue(shop.tenant.id, facetSlug, valueSlug);
  const sp = await searchParams;
  return (
    <CatalogView
      shop={shop}
      mode="shop"
      basePath={facetValueHref(facet.slug, value.slug)}
      searchParams={sp}
      lockedFacets={[token]}
      title={copy.facet.title(path.join(" › "))}
      intro={<p>{copy.facet.intro(facet.name, path.join(" › "))}</p>}
      crumbs={[{ label: copy.shop.title, href: SHOP_PATH }, { label: facet.name }, { label: value.name }]}
    />
  );
}
