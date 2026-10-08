import "server-only";
import type { ShopContext } from "@/server/storefront/context";
import { shopCache } from "@/server/storefront/cache";
import { getShopQuoteZones } from "@/server/storefront/shipping";
import { REST_OF_WORLD, isCountryCode } from "@/server/shipping/countries";
import type { QuoteZone } from "@/server/shipping/calc";
import type { SeoShop } from "@/lib/seo/json-ld";
import { evaluateCompliance, getCompiledRules, type ComplianceProductFacts } from "@/server/compliance/resolve";
import * as q from "./queries";

/*
 * SEO / GEO data for sitemaps, the merchant feed, llms.txt and structured data.
 *
 * Caching: every read goes through `shopCache` (unstable_cache, tagged per tenant + area), so the
 * audited admin mutations that already invalidate the shop (src/server/storefront/cache.ts
 * `shopTagsForAction`: product/category/facet/compliance/order → catalog, content → content,
 * settings/shipping → whole tenant) refresh these too. Product lists are cached per page of
 * SITEMAP_PAGE_SIZE / FEED_PAGE_SIZE rows so no entry exceeds Next's 2 MB data-cache limit.
 */

export const getIndexableProductCount = shopCache("seo-product-count", "catalog", q.countIndexableProducts);
export const getIndexableProductsPage = shopCache("seo-products", "catalog", q.listIndexableProducts);
export const getFeedProductCount = shopCache("seo-feed-count", "catalog", q.countFeedProducts);
export const getFeedProductsPage = shopCache("seo-feed", "catalog", q.listFeedProducts);
export const getSitemapPages = shopCache("seo-pages", "content", q.listSitemapPages);
export const getSitemapCategories = shopCache("seo-categories", "catalog", q.listSitemapCategories);
export const getSitemapFacetValues = shopCache("seo-facets", "catalog", q.listSitemapFacetValues);
export const getHasPublicProvenance = shopCache("seo-has-provenance", "catalog", q.hasPublicProvenance);
export const getCategoryDescriptions = shopCache("seo-category-text", "catalog", q.listCategoryDescriptions);
export { SITEMAP_PAGE_SIZE, FEED_PAGE_SIZE, type SeoProductRow, type FeedProductRow } from "./queries";

/** Upper bound on cached pages read for one response (feed: 400 × 100 = 40,000 items). */
export const MAX_PAGES = 100;

/** The shop's own country (settings general.address.country), "" when unset. */
export function shopCountry(shop: ShopContext): string {
  return shop.settings.general.address.country || "";
}

/** Countries the shop delivers to (explicit delivery-zone countries) plus its own country. */
export function deliveryCountries(zones: readonly QuoteZone[], own: string): string[] {
  const set = new Set<string>(own && isCountryCode(own) ? [own] : []);
  for (const z of zones) {
    if (!z.isActive || z.isPickup) continue;
    for (const c of z.countries) if (c !== REST_OF_WORLD && isCountryCode(c)) set.add(c);
  }
  return [...set];
}

/** Shop facts for the JSON-LD / llms builders. `zones` (cached) decides where returns apply. */
export function seoShop(shop: ShopContext, zones: readonly QuoteZone[] = []): SeoShop {
  const { general, appearance, content, legal } = shop.settings;
  return {
    origin: shop.origin,
    name: shop.shopName,
    currency: shop.tenant.currency,
    description: content.seo.description || null,
    logoPath: appearance.logoPath,
    email: general.contactEmail,
    phone: general.phone,
    address: general.address,
    sameAs: content.seo.sameAs,
    vatNumber: general.vatNumber,
    cocNumber: general.cocNumber,
    returns: { days: legal.returns.days, fees: legal.returns.fees, countries: deliveryCountries(zones, general.address.country) },
  };
}

/** seoShop with the cached shipping zones loaded. */
export async function loadSeoShop(shop: ShopContext): Promise<{ seo: SeoShop; zones: QuoteZone[] }> {
  const zones = await getShopQuoteZones(shop.tenant.id).catch(() => [] as QuoteZone[]);
  return { seo: seoShop(shop, zones), zones };
}

/** Default meta description of the shop (settings → generated). */
export function shopDescription(shop: ShopContext): string {
  return shop.settings.content.seo.description || `${shop.shopName}: militaria and historical collectibles. Every item is unique and individually described.`;
}

/** Delivery countries where a compliance rule forbids shipping (or showing) this product. Cached rules. */
export async function blockedShippingCountries(tenantId: string, product: ComplianceProductFacts, countries: readonly string[]): Promise<string[]> {
  const rules = await getCompiledRules(tenantId);
  if (!rules.length) return [];
  return countries.filter((c) => evaluateCompliance(rules, product, c).noShipping);
}
