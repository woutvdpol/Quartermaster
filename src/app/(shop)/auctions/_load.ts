import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicAuction } from "@/server/auctions/public";
import { resolveCompliance, visitorCountry } from "@/server/compliance";
import { getShopCustomer } from "@/server/customer-auth/current";
import { isEmailVerified } from "@/server/email-verification";
import { requireShop } from "@/server/storefront/context";
import { getShopViewer } from "@/server/storefront/viewer";

/*
 * Shared loading for the auction catalogue and lot pages (memoised per request: generateMetadata and
 * the page share one query). Lots a compliance rule hides in the visitor's country are left out (and
 * their lot page 404s), like products.
 */

/**
 * The shop context for an auction page; 404 when the shop lacks the auctions module (docs/modules.md).
 * Not used by /auctions/pay/<token> (winners of finished lots can still pay) and /auctions/terms.
 */
export async function requireAuctionShop() {
  const shop = await requireShop();
  if (!shop.settings.features.auctions) notFound();
  return shop;
}

export const loadAuction = cache(async (slug: string) => {
  const shop = await requireAuctionShop();
  const auction = await getPublicAuction(shop.tenant.id, slug);
  if (!auction) notFound();
  const country = visitorCountry(await headers());
  const verdicts = country && auction.lots.length ? await resolveCompliance(shop.tenant.id, auction.lots.map((l) => l.productId), country) : {};
  const lots = auction.lots.filter((l) => !verdicts[l.productId]?.hidden);
  return { shop, auction: { ...auction, lots }, verdicts, country };
});

/** Who is looking: a signed-in customer of this shop (verified or not), staff (the owner), or a guest. */
export const loadViewer = cache(async (tenantId: string) => {
  const c = await getShopCustomer();
  if (c && c.tenant.id === tenantId) {
    return { kind: "customer" as const, customerId: c.customer.id, verified: await isEmailVerified(c.user.id) };
  }
  const v = await getShopViewer(tenantId);
  if (v?.role === "OWNER") return { kind: "staff" as const };
  return { kind: "guest" as const };
});
