import "server-only";
import { db } from "@/server/db";
import { imageUrl } from "@/server/media/product-images";
import type { OfferMailData } from "@/emails/commerce/types";

/** Plain data the offer mails render (tenant-scoped, loaded when the mail is sent). Null when gone. */
export async function loadOfferMailData(tenantId: string, offerId: string, baseUrl: string) {
  const offer = await db.offer.findFirst({
    where: { id: offerId, tenantId },
    include: {
      product: {
        select: {
          title: true,
          slug: true,
          stockCode: true,
          price: true,
          blurred: true,
          images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true } },
        },
      },
    },
  });
  if (!offer) return null;
  const p = offer.product;
  const img = p.images[0];
  const data: OfferMailData = {
    productTitle: p.title,
    productUrl: `${baseUrl}/product/${p.stockCode}/${p.slug}`,
    // Sensitive items are never shown un-blurred outside a login.
    imageUrl: img && !p.blurred ? `${baseUrl}${imageUrl(img.storageKey, "thumb")}` : null,
    stockCode: p.stockCode,
    currency: offer.currency,
    listPrice: p.price,
    amount: offer.amount,
    counterAmount: offer.counterAmount,
    agreedAmount: offer.agreedAmount,
    customerName: offer.name,
    email: offer.email,
    message: offer.message,
    responseNote: offer.responseNote,
  };
  return { offer, data };
}
