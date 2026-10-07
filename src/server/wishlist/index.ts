import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { imageUrl } from "@/server/media/product-images";
import { getShopCustomer } from "@/server/customer-auth/current";
import type { ProductStatus } from "@/generated/prisma/enums";

/*
 * Wishlist (decision: logged-in customers only). Items reference products of the same tenant;
 * only products visible in the shop (ACTIVE / RESERVED / SOLD) can be added or are listed —
 * DRAFT, ARCHIVED and STOLEN products stay in the table but are never shown.
 * Callers pass the signed-in customer's (tenantId, customerId) — see getShopCustomer().
 */

export const MAX_WISHLIST_ITEMS = 500;
export const WISHLIST_VISIBLE_STATUSES: ProductStatus[] = ["ACTIVE", "RESERVED", "SOLD"];

type Owner = { tenantId: string; customerId: string };

const productIdSchema = z.string().trim().min(1).max(64);

export type WishlistResult = { ok: true; inWishlist: boolean } | { ok: false; error: "not_found" | "limit" };

export async function addToWishlist(owner: Owner, productId: string): Promise<WishlistResult> {
  const id = productIdSchema.safeParse(productId);
  if (!id.success) return { ok: false, error: "not_found" };
  const product = await db.product.findFirst({
    where: { id: id.data, tenantId: owner.tenantId, status: { in: WISHLIST_VISIBLE_STATUSES } },
    select: { id: true },
  });
  if (!product) return { ok: false, error: "not_found" };
  const count = await db.wishlistItem.count({ where: { customerId: owner.customerId } });
  if (count >= MAX_WISHLIST_ITEMS) return { ok: false, error: "limit" };
  await db.wishlistItem.createMany({
    data: [{ tenantId: owner.tenantId, customerId: owner.customerId, productId: product.id }],
    skipDuplicates: true,
  });
  return { ok: true, inWishlist: true };
}

export async function removeFromWishlist(owner: Owner, productId: string): Promise<WishlistResult> {
  const id = productIdSchema.safeParse(productId);
  if (!id.success) return { ok: false, error: "not_found" };
  await db.wishlistItem.deleteMany({ where: { tenantId: owner.tenantId, customerId: owner.customerId, productId: id.data } });
  return { ok: true, inWishlist: false };
}

export async function toggleWishlist(owner: Owner, productId: string, on: boolean): Promise<WishlistResult> {
  return on ? addToWishlist(owner, productId) : removeFromWishlist(owner, productId);
}

/** Which of the given (shop-visible) products are on the customer's wishlist. */
export async function wishlistProductIds(owner: Owner, productIds?: string[]): Promise<Set<string>> {
  const rows = await db.wishlistItem.findMany({
    where: {
      tenantId: owner.tenantId,
      customerId: owner.customerId,
      product: { status: { in: WISHLIST_VISIBLE_STATUSES } },
      ...(productIds ? { productId: { in: productIds.slice(0, 500) } } : {}),
    },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

export function wishlistCount(owner: Owner): Promise<number> {
  return db.wishlistItem.count({
    where: { tenantId: owner.tenantId, customerId: owner.customerId, product: { status: { in: WISHLIST_VISIBLE_STATUSES } } },
  });
}

/**
 * Header badge: wishlist size of the signed-in customer of this host (0 for guests/staff).
 * Reads the session — call inside a Suspense boundary (see src/server/storefront/header-counts.ts).
 */
export async function currentWishlistCount(tenantId: string): Promise<number> {
  const c = await getShopCustomer();
  if (!c || c.tenant.id !== tenantId) return 0;
  return wishlistCount({ tenantId, customerId: c.customer.id });
}

export type WishlistAvailability = "available" | "reserved" | "sold";

export type WishlistEntry = {
  productId: string;
  addedAt: Date;
  title: string;
  slug: string;
  stockCode: number;
  price: number;
  onSale: boolean;
  blurred: boolean;
  availability: WishlistAvailability;
  image: { url: string; alt: string | null; width: number | null; height: number | null } | null;
};

export function availabilityOf(p: { status: ProductStatus; quantity: number }, hasActiveReservation: boolean): WishlistAvailability {
  if (p.status === "SOLD" || p.quantity <= 0) return "sold";
  if (p.status === "RESERVED" || hasActiveReservation) return "reserved";
  return "available";
}

export async function listWishlist(owner: Owner): Promise<WishlistEntry[]> {
  const now = new Date();
  const rows = await db.wishlistItem.findMany({
    where: { tenantId: owner.tenantId, customerId: owner.customerId, product: { tenantId: owner.tenantId, status: { in: WISHLIST_VISIBLE_STATUSES } } },
    orderBy: { createdAt: "desc" },
    take: MAX_WISHLIST_ITEMS,
    select: {
      createdAt: true,
      product: {
        select: {
          id: true,
          title: true,
          slug: true,
          stockCode: true,
          price: true,
          onSale: true,
          blurred: true,
          status: true,
          quantity: true,
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { storageKey: true, alt: true, width: true, height: true, processedAt: true } },
          reservations: { where: { status: "ACTIVE", expiresAt: { gt: now } }, take: 1, select: { id: true } },
        },
      },
    },
  });
  return rows.map(({ createdAt, product: p }) => {
    const img = p.images[0];
    return {
      productId: p.id,
      addedAt: createdAt,
      title: p.title,
      slug: p.slug,
      stockCode: p.stockCode,
      price: p.price,
      onSale: p.onSale,
      blurred: p.blurred,
      availability: availabilityOf(p, p.reservations.length > 0),
      image: img
        ? { url: imageUrl(img.storageKey, img.processedAt ? "card" : "original"), alt: img.alt, width: img.width, height: img.height }
        : null,
    };
  });
}
