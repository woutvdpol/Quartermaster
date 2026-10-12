import { notFound } from "next/navigation";
import { lotHref } from "@/components/shop/auctions/server";
import { loadPublicLot } from "@/server/auctions/public";
import { db } from "@/server/db";
import { localeRedirect } from "@/server/i18n/locale";
import { requireShop } from "@/server/storefront/context";

/*
 * /auctions/lot/<lotId> — short link used by notifications (AUCTION_PATHS.lot in src/server/auctions/paths.ts:
 * outbid / ending pushes and mails). Redirects to the lot's canonical page /auctions/<slug>/lot/<n>.
 */

export default async function LotShortLink({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = await params;
  const shop = await requireShop();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(lotId)) notFound();
  const lot = await loadPublicLot(shop.tenant.id, lotId);
  if (!lot) notFound();
  const auction = await db.auction.findFirst({ where: { id: lot.auctionId, tenantId: shop.tenant.id }, select: { slug: true } });
  if (!auction) notFound();
  return localeRedirect(lotHref(auction.slug, lot.lotNumber));
}
