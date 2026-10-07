import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getRequestScope, normalizeHost } from "@/server/tenant";
import { getSettings } from "@/server/settings";
import { shopCache } from "./cache";

/*
 * The shop a request is for, plus the PUBLIC subset of its settings. Never put purchase/platform
 * internals in here: this object is passed to client components (header, age gate, analytics).
 */

export type PublicShopSettings = Awaited<ReturnType<typeof loadPublicSettings>>;

export type ShopTenant = { id: string; slug: string; name: string; currency: string; timezone: string };

export type ShopContext = {
  tenant: ShopTenant;
  /** Request host incl. port in dev ("concept.localhost:3000"). */
  host: string;
  /** Absolute origin for canonical URLs, sitemap and JSON-LD ("https://shop.nl"). */
  origin: string;
  /** general.shopName, falling back to the tenant name. */
  shopName: string;
  settings: PublicShopSettings;
};

async function loadPublicSettings(tenantId: string) {
  const [general, appearance, catalog, checkout, content, legal, analytics, platform] = await Promise.all([
    getSettings(tenantId, "general"),
    getSettings(tenantId, "appearance"),
    getSettings(tenantId, "catalog"),
    getSettings(tenantId, "checkout"),
    getSettings(tenantId, "content"),
    getSettings(tenantId, "legal"),
    getSettings(tenantId, "analytics"),
    getSettings(tenantId, "platform"),
  ]);
  return {
    general: {
      shopName: general.shopName,
      contactEmail: general.contactEmail,
      phone: general.phone,
      address: general.address,
      displayCurrencies: general.displayCurrencies,
    },
    appearance,
    catalog: {
      layout: catalog.layout,
      gridColumns: catalog.gridColumns,
      defaultSort: catalog.defaultSort,
      endlessScroll: catalog.endlessScroll,
      showPriceWhenSold: catalog.showPriceWhenSold,
      priceFilter: catalog.priceFilter,
      showTags: catalog.showTags,
      showStockCode: catalog.showStockCode,
      publicArchive: catalog.publicArchive,
      relatedProducts: catalog.relatedProducts,
      specifications: catalog.specifications,
      allowOffersDefault: catalog.allowOffersDefault,
    },
    checkout: {
      reservationMinutes: checkout.reservationMinutes,
      guestCheckout: checkout.guestCheckout,
      directCheckout: checkout.directCheckout,
      termsPageSlug: checkout.termsPageSlug,
      minimumOrderCents: checkout.minimumOrderCents,
      freeShippingThresholdCents: checkout.freeShippingThresholdCents,
    },
    content,
    legal,
    analytics: { provider: analytics.provider },
    features: { newsletter: platform.newsletterEnabled },
  };
}

const cachedPublicSettings = shopCache("public-settings", "settings", loadPublicSettings);

/** Is this host served over plain http (local development)? */
export function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name.endsWith(".localhost") || name.endsWith(".test");
}

/** Absolute origin for a host: http for local dev hosts, otherwise https. */
export function originForHost(host: string, forwardedProto?: string | null): string {
  const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : isLocalHost(host) ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * The shop for the current request, or null on the platform host / unknown hosts.
 * Memoised per request (React cache); settings come from the data cache (60 s, tag-revalidated).
 */
export const getShopContext = cache(async (): Promise<ShopContext | null> => {
  const scope = await getRequestScope();
  if (scope.kind !== "tenant") return null;
  const h = await headers();
  const host = normalizeHost(h.get("host")) ?? "";
  const t = scope.tenant;
  const settings = await cachedPublicSettings(t.id);
  return {
    tenant: { id: t.id, slug: t.slug, name: t.name, currency: t.currency, timezone: t.timezone },
    host,
    origin: originForHost(host, h.get("x-forwarded-proto")),
    shopName: settings.general.shopName || t.name,
    settings,
  };
});

/** Like getShopContext, but 404s when the host is not a shop. Use at the top of every shop page. */
export async function requireShop(): Promise<ShopContext> {
  const shop = await getShopContext();
  if (!shop) notFound();
  return shop;
}
