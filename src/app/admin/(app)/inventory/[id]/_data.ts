import "server-only";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import { HARD_MAX_IMAGES_PER_PRODUCT } from "@/server/media/product-images";

/*
 * Small read helpers for the product screens where no service function exists yet.
 * (Raw db reads, always scoped by ctx.tenantId.) Candidates to move into a tenant / wishlist service.
 */

/** How many customers have the product on their wishlist. */
export async function countWishlisted(ctx: ServiceContext, productId: string): Promise<number> {
  return db.wishlistItem.count({ where: { tenantId: ctx.tenantId, productId } });
}

/** Photo limit per product, mirroring limitsFor() in src/server/media/product-images.ts. */
export async function photoLimit(ctx: ServiceContext): Promise<number> {
  const platform = await getSettings(ctx.tenantId, "platform");
  return Math.min(platform.photoLimit ?? HARD_MAX_IMAGES_PER_PRODUCT, HARD_MAX_IMAGES_PER_PRODUCT);
}
