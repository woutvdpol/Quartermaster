import "server-only";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import { HARD_MAX_IMAGES_PER_PRODUCT } from "@/server/media/product-images";

/*
 * Small read helpers for the product screens where no service function exists yet.
 * (Raw db reads, always scoped by ctx.tenantId.) Candidates to move into a tenant / wishlist service.
 */

export type TenantDisplay = { currency: string; timeZone: string; name: string; shopHost: string };

/** Currency, timezone and the shop's primary host (for the SERP preview). */
export async function getTenantDisplay(ctx: ServiceContext): Promise<TenantDisplay> {
  const t = await db.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: {
      currency: true,
      timezone: true,
      name: true,
      slug: true,
      domains: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { host: true } },
    },
  });
  return {
    currency: t?.currency ?? "EUR",
    timeZone: t?.timezone ?? "Europe/Amsterdam",
    name: t?.name ?? "",
    shopHost: t?.domains[0]?.host ?? `${t?.slug ?? "shop"}.example`,
  };
}

/** How many customers have the product on their wishlist. */
export async function countWishlisted(ctx: ServiceContext, productId: string): Promise<number> {
  return db.wishlistItem.count({ where: { tenantId: ctx.tenantId, productId } });
}

/** Photo limit per product, mirroring limitsFor() in src/server/media/product-images.ts. */
export async function photoLimit(ctx: ServiceContext): Promise<number> {
  const platform = await getSettings(ctx.tenantId, "platform");
  return Math.min(platform.photoLimit ?? HARD_MAX_IMAGES_PER_PRODUCT, HARD_MAX_IMAGES_PER_PRODUCT);
}
