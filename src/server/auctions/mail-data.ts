import "server-only";
import { db } from "@/server/db";
import { imageUrl } from "@/server/media/product-images";
import type { AuctionLotMailData } from "@/emails/auctions/types";
import { AUCTION_PATHS } from "./paths";
import { DAY_MS, payToken } from "./shared";

/** Plain data the auction mails render (tenant-scoped, loaded when the mail is sent). Null when gone. */
export async function loadAuctionLotMailData(tenantId: string, lotId: string, customerId: string | null, baseUrl: string) {
  const lot = await db.auctionLot.findFirst({
    where: { id: lotId, tenantId },
    select: {
      id: true,
      lotNumber: true,
      status: true,
      closesAt: true,
      closedAt: true,
      currentBid: true,
      leadingBidderId: true,
      orderId: true,
      auction: { select: { title: true, payDays: true } },
      tenant: { select: { currency: true, timezone: true } },
      order: { select: { paymentStatus: true, canceledAt: true, finalizedAt: true } },
      product: {
        select: { title: true, blurred: true, images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true } } },
      },
    },
  });
  const who = customerId ?? lot?.leadingBidderId ?? null;
  if (!lot || !who) return null;
  const customer = await db.customer.findFirst({ where: { id: who, tenantId }, select: { email: true, firstName: true, lastName: true } });
  if (!customer) return null;
  const img = lot.product.images[0];
  const data: AuctionLotMailData = {
    productTitle: lot.product.title,
    lotUrl: `${baseUrl}${AUCTION_PATHS.lot(lot.id)}`,
    // Sensitive items are never shown un-blurred outside a login.
    imageUrl: img && !lot.product.blurred ? `${baseUrl}${imageUrl(img.storageKey, "thumb")}` : null,
    lotNumber: lot.lotNumber,
    auctionTitle: lot.auction.title,
    currency: lot.tenant.currency,
    amount: lot.currentBid ?? 0,
    customerName: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email,
    email: customer.email,
    payBy: lot.closedAt ? new Date(lot.closedAt.getTime() + lot.auction.payDays * DAY_MS) : null,
    timeZone: lot.tenant.timezone,
  };
  const payUrl = lot.orderId ? `${baseUrl}${AUCTION_PATHS.pay(payToken(tenantId, lot.id, lot.orderId))}` : null;
  return { lot, data, payUrl };
}
