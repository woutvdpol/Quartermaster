import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { getCompiledRules } from "@/server/compliance/resolve";
import { catalogTag } from "@/server/storefront-catalog/cache";
import { toPublicImage } from "@/server/storefront-catalog/queries";
import { searchAcrossTenants, searchImageAcrossTenants } from "@/server/search";
import type { RgbImage } from "@/server/search/embedder";
import { toShopImage } from "@/components/shop/catalog/to-card";
import type { ShopImage } from "@/components/shop/ui/types";
import { dealerProductUrl, dealerShopUrl } from "@/lib/network";
import {
  NETWORK_TENANT_WHERE,
  facetValueIdsFor,
  networkExclusionFor,
  networkFacetOptions,
  networkProductWhere,
  shipsToCountry,
  type FacetValueFacts,
  type NetworkFacetOption,
  type ZoneFacts,
} from "./eligibility";
import { NETWORK_PAGE_SIZE, type NetworkSearchParams } from "./params";

/*
 * Quartermaster network reads (docs/network.md). Public and read-only: nothing here selects more than a
 * shop already shows its own visitors (no purchase prices, notes, customers or settings beyond the
 * public shop name, logo and address country).
 *
 * Caching: the dealer directory (dealers, shipping zones, period/country values) and each search result
 * page live in the data cache for NETWORK_CACHE_SECONDS. Search entries also carry every dealer's catalog
 * tag, so a product change in any dealer shop (audited → tag revalidated) drops them at once; opt-in
 * changes revalidate NETWORK_TAG.
 */

export const NETWORK_TAG = "network";
export const NETWORK_CACHE_SECONDS = 60;
const MAX_DEALER_TAGS = 120;

export type NetworkDealer = {
  id: string;
  slug: string;
  name: string;
  host: string;
  shopUrl: string;
  /** Business address country (ISO-2) or null. */
  country: string | null;
  logoPath: string | null;
  currency: string;
  joinedAt: string | null;
  /** Network-eligible products (before per-country rules). */
  productCount: number;
  zones: ZoneFacts[];
};

export type NetworkDirectory = {
  dealers: NetworkDealer[];
  facetValues: FacetValueFacts[];
  totalProducts: number;
};

export type NetworkCard = {
  id: string;
  stockCode: number;
  title: string;
  price: number;
  currency: string;
  /** Absolute URL in the dealer's own shop. */
  href: string;
  dealer: { slug: string; name: string };
  image: ShopImage | null;
};

export type NetworkSearchResult = {
  items: NetworkCard[];
  total: number;
  page: number;
  pageSize: number;
  /** Results per dealer slug (for "N pieces at M dealers"). */
  perDealer: Record<string, number>;
  /** Free text that was searched. */
  text: string;
};

// ─── Directory ──────────────────────────────────────────────────────────────

/** Opted-in, live dealers with what the network needs about them. Uncached (tests, scripts). */
export async function loadNetworkDirectory(): Promise<NetworkDirectory> {
  const tenants = await db.tenant.findMany({
    where: NETWORK_TENANT_WHERE,
    select: {
      id: true,
      slug: true,
      name: true,
      currency: true,
      networkJoinedAt: true,
      domains: { where: { isPrimary: true }, select: { host: true }, take: 1 },
      shippingZones: { select: { countries: true, isActive: true, isPickup: true } },
    },
    orderBy: { name: "asc" },
  });
  const ids = tenants.map((t) => t.id);
  if (!ids.length) return { dealers: [], facetValues: [], totalProducts: 0 };
  const [settings, counts, values] = await Promise.all([
    Promise.all(ids.map((id) => Promise.all([getSettings(id, "general"), getSettings(id, "appearance")]))),
    db.$queryRaw<{ tenantId: string; n: number }[]>`
      SELECT p."tenantId" AS "tenantId", count(*)::int AS n FROM products p WHERE ${networkProductWhere({ tenantIds: ids })} GROUP BY 1`,
    db.facetValue.findMany({
      where: { tenantId: { in: ids }, facet: { kind: { in: ["PERIOD", "COUNTRY"] }, isFilterable: true } },
      select: { id: true, tenantId: true, parentId: true, name: true, facet: { select: { kind: true } } },
    }),
  ]);
  const countBy = new Map(counts.map((c) => [c.tenantId, c.n]));
  const dealers = tenants.map((t, i) => {
    const [general, appearance] = settings[i];
    const host = t.domains[0].host;
    return {
      id: t.id,
      slug: t.slug,
      name: general.shopName || t.name,
      host,
      shopUrl: dealerShopUrl(host),
      country: general.address.country || null,
      logoPath: appearance.logoPath ?? null,
      currency: t.currency,
      joinedAt: t.networkJoinedAt?.toISOString() ?? null,
      productCount: countBy.get(t.id) ?? 0,
      zones: t.shippingZones,
    };
  });
  return {
    dealers: dealers.sort((a, b) => a.name.localeCompare(b.name)),
    facetValues: values.map((v) => ({ id: v.id, tenantId: v.tenantId, parentId: v.parentId, name: v.name, kind: v.facet.kind })),
    totalProducts: dealers.reduce((n, d) => n + d.productCount, 0),
  };
}

const cachedDirectory = unstable_cache(loadNetworkDirectory, ["network", "directory"], { tags: [NETWORK_TAG], revalidate: NETWORK_CACHE_SECONDS });

export async function getNetworkDirectory(): Promise<NetworkDirectory> {
  try {
    return await cachedDirectory();
  } catch {
    // Outside a Next request (scripts, tests) there is no incremental cache.
    return loadNetworkDirectory();
  }
}

/** Period / country filter options across the network. */
export function networkFilterOptions(dir: NetworkDirectory): { period: NetworkFacetOption[]; country: NetworkFacetOption[] } {
  return { period: networkFacetOptions(dir.facetValues, "PERIOD"), country: networkFacetOptions(dir.facetValues, "COUNTRY") };
}

/** Makes opt-in / moderation changes visible on the network at once. No-op outside Next. */
export function revalidateNetwork(): void {
  try {
    revalidateTag(NETWORK_TAG, { expire: 0 });
  } catch {
    // not in a request scope
  }
}

// ─── Search ─────────────────────────────────────────────────────────────────

async function scopeFor(dir: NetworkDirectory, params: Pick<NetworkSearchParams, "dealers" | "ships" | "period" | "country">, visitorCountry: string | null) {
  let dealers = dir.dealers;
  if (params.dealers.length) dealers = dealers.filter((d) => params.dealers.includes(d.slug));
  if (params.ships && visitorCountry) dealers = dealers.filter((d) => shipsToCountry(d.zones, visitorCountry));
  const tenantIds = dealers.map((d) => d.id);
  const rules = await Promise.all(tenantIds.map((id) => getCompiledRules(id)));
  const exclusions = Object.fromEntries(tenantIds.map((id, i) => [id, networkExclusionFor(rules[i], visitorCountry)]));
  const where = networkProductWhere({
    tenantIds,
    exclusions,
    facetValueIds: [facetValueIdsFor(dir.facetValues, "PERIOD", params.period), facetValueIdsFor(dir.facetValues, "COUNTRY", params.country)],
  });
  return { tenantIds, where };
}

/** Cards for ids (in order), restricted to network dealers. */
async function loadNetworkCards(dir: NetworkDirectory, ids: string[]): Promise<NetworkCard[]> {
  if (!ids.length) return [];
  const dealerById = new Map(dir.dealers.map((d) => [d.id, d]));
  const rows = await db.product.findMany({
    where: { id: { in: ids }, tenantId: { in: [...dealerById.keys()] } },
    select: {
      id: true,
      tenantId: true,
      stockCode: true,
      slug: true,
      title: true,
      price: true,
      images: { select: { id: true, storageKey: true, variants: true, alt: true, width: true, height: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1 },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    const dealer = p && dealerById.get(p.tenantId);
    if (!p || !dealer) return [];
    return [
      {
        id: p.id,
        stockCode: p.stockCode,
        title: p.title,
        price: p.price,
        currency: dealer.currency,
        href: dealerProductUrl(dealer.host, p),
        dealer: { slug: dealer.slug, name: dealer.name },
        image: p.images[0] ? toShopImage(toPublicImage(p.images[0]), p.title) : null,
      },
    ];
  });
}

async function perDealerCounts(dir: NetworkDirectory, ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const rows = await db.$queryRaw<{ tenantId: string; n: number }[]>`
    SELECT p."tenantId" AS "tenantId", count(*)::int AS n FROM products p WHERE p.id = ANY(${ids}::text[]) GROUP BY 1`;
  const slugById = new Map(dir.dealers.map((d) => [d.id, d.slug]));
  return Object.fromEntries(rows.flatMap((r) => (slugById.has(r.tenantId) ? [[slugById.get(r.tenantId)!, r.n]] : [])));
}

/** One page of network results (uncached). */
export async function runNetworkSearch(dir: NetworkDirectory, params: NetworkSearchParams, visitorCountry: string | null): Promise<NetworkSearchResult> {
  const { tenantIds, where } = await scopeFor(dir, params, visitorCountry);
  const r = await searchAcrossTenants({ tenantIds, where, q: params.q, sort: params.sort });
  const pageIds = r.ids.slice((params.page - 1) * NETWORK_PAGE_SIZE, params.page * NETWORK_PAGE_SIZE);
  const [items, perDealer] = await Promise.all([loadNetworkCards(dir, pageIds), perDealerCounts(dir, r.ids)]);
  return { items, total: r.ids.length, page: params.page, pageSize: NETWORK_PAGE_SIZE, perDealer, text: r.text };
}

/** Network search for the page: data-cached per (params, visitor country); see the header. */
export async function searchNetwork(params: NetworkSearchParams, visitorCountry: string | null): Promise<NetworkSearchResult> {
  const dir = await getNetworkDirectory();
  const run = () => runNetworkSearch(dir, params, visitorCountry);
  // Next caps the tags of one entry (128): beyond that, the short lifetime alone keeps results fresh.
  const dealerTags = dir.dealers.length <= MAX_DEALER_TAGS ? dir.dealers.map((d) => catalogTag(d.id)) : [];
  try {
    return await unstable_cache(run, ["network", "search", JSON.stringify(params), visitorCountry ?? "-"], {
      tags: [NETWORK_TAG, ...dealerTags],
      revalidate: NETWORK_CACHE_SECONDS,
    })();
  } catch {
    // Outside a Next request there is no incremental cache; a real DB error surfaces again from run().
    return run();
  }
}

/** Photo search across all network dealers (not cached: the photo is the key). Throws SearchUnavailableError. */
export async function searchNetworkByImage(image: RgbImage, visitorCountry: string | null, limit = 48): Promise<{ items: NetworkCard[]; scores: Record<string, number> }> {
  const dir = await getNetworkDirectory();
  const { tenantIds, where } = await scopeFor(dir, { dealers: [], ships: false, period: [], country: [] }, visitorCountry);
  const r = await searchImageAcrossTenants({ tenantIds, where, image });
  const items = await loadNetworkCards(dir, r.ids.slice(0, limit));
  return { items, scores: Object.fromEntries(items.map((c) => [c.id, r.scores[c.id] ?? 0])) };
}
