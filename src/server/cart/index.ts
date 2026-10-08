import "server-only";
import { cache } from "react";
import { z } from "zod";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { getSettings } from "@/server/settings";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { reserveProduct, releaseReservation } from "@/server/stock/reservations";
import { imageUrl } from "@/server/media/product-images";
import type { Prisma } from "@/generated/prisma/client";
import type { ShopViewer } from "./viewer";
import { lineState, minutesUntil, type CartLineState } from "./state";
import { offerPriceApplies } from "@/server/offers/rules";

export { lineState, minutesUntil, type CartLineState } from "./state";
export { getShopViewer, type ShopViewer } from "./viewer";

/*
 * Shopping cart (storefront). Replaces the legacy session basket (docs/analysis/03 §2.4):
 *  - The cart is a DB row identified by a random token in the httpOnly cookie `qm_cart`; only the
 *    SHA-256 of the token is stored (Cart.tokenHash), like sessions.
 *  - Every product is unique (quantity 1). Adding reserves it for `checkout.reservationMinutes`
 *    (default 15) through stock/reservations — the reservation is LINKED to the cart, so another
 *    visitor can't add it while it is held (legacy: no link, two people could buy the same item).
 *  - Reading never mutates: a lapsed reservation is reported as such ("re-add"), items that were sold
 *    or unpublished are flagged "unavailable". Mutations (add/remove/re-reserve/checkout) clean up.
 *  - Tenant isolation: every query filters on the tenantId that came from the request host.
 */

export const CART_COOKIE = "qm_cart";
/** Cart rows (and the cookie) live this long after the last change. */
export const CART_TTL_DAYS = 30;

type Tx = Prisma.TransactionClient;

const productIdSchema = z.string().trim().min(1).max(64);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

export type CartLine = {
  productId: string;
  stockCode: number;
  slug: string;
  title: string;
  /** Minor units, shop currency: the agreed offer price when `offerApplied`, else the live list price. */
  price: number;
  /** Live product (list) price. */
  listPrice: number;
  /** Offer behind this line (bought via a personal offer link), or null. */
  offerId: string | null;
  /** The agreed offer price is used for this line (offer accepted, link not expired, not used yet). */
  offerApplied: boolean;
  /** The line came from an offer whose agreed price no longer applies → list price. */
  offerExpired: boolean;
  weightGrams: number;
  imageUrl: string | null;
  imageAlt: string | null;
  blurDataUrl: string | null;
  blurred: boolean;
  ageRestricted: boolean;
  state: CartLineState;
  /** held: when this cart's hold ends. taken: when the other hold ends (may be extended by them). */
  expiresAt: Date | null;
  addedAt: Date;
};

export type CartView = {
  id: string;
  currency: string;
  countryCode: string | null;
  customerId: string | null;
  /** Coupon code entered in the cart (validated by the quote / again at placement). */
  couponCode: string | null;
  /** Email captured at checkout (abandoned-cart reminder, only with `reminderConsent`). */
  email: string | null;
  reminderConsent: boolean;
  lines: CartLine[];
  /** Σ price of lines that can still be bought (held or lapsed-but-free). */
  subtotal: number;
  /** Part of `subtotal` a coupon applies to (lines at an agreed offer price excluded). */
  couponBase: number;
  weightGrams: number;
  /** Lines that can still be bought (held or lapsed). */
  buyableCount: number;
  /** Earliest expiry among held lines (for a summary countdown). */
  earliestExpiry: Date | null;
};

export function cartExpiry(now = new Date()): Date {
  return new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** The cart for a cookie token in this tenant, or null (unknown / other tenant / expired / malformed). */
export async function findCart(tenantId: string, token: string | null | undefined, client: Tx | typeof db = db) {
  if (!token || !tokenSchema.safeParse(token).success) return null;
  const cart = await client.cart.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!cart || cart.tenantId !== tenantId || cart.expiresAt.getTime() <= Date.now()) return null;
  return cart;
}

/** Locks the cart row for the rest of the transaction (serialises add/remove/checkout of one cart). */
export async function lockCart(tx: Tx, tenantId: string, token: string | null | undefined) {
  if (!token || !tokenSchema.safeParse(token).success) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM carts WHERE "tokenHash" = ${hashToken(token)} AND "tenantId" = ${tenantId} AND "expiresAt" > now() FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.cart.findUniqueOrThrow({ where: { id: rows[0].id } });
}

async function createCart(tx: Tx, tenantId: string, viewer: ShopViewer | null) {
  const token = generateToken();
  const cart = await tx.cart.create({
    data: { tenantId, tokenHash: hashToken(token), customerId: viewer?.customerId ?? null, expiresAt: cartExpiry() },
  });
  return { cart, token };
}

async function loadLines(tenantId: string, cartId: string, client: Tx | typeof db = db): Promise<CartLine[]> {
  const items = await client.cartItem.findMany({
    where: { tenantId, cartId },
    orderBy: [{ addedAt: "asc" }, { id: "asc" }],
    select: {
      addedAt: true,
      offerId: true,
      product: {
        select: {
          id: true,
          tenantId: true,
          stockCode: true,
          slug: true,
          title: true,
          price: true,
          weightGrams: true,
          status: true,
          quantity: true,
          blurred: true,
          ageRestricted: true,
          images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true, alt: true, variants: true } },
          reservations: {
            where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
            select: { cartId: true, orderId: true, expiresAt: true },
            take: 1,
          },
        },
      },
    },
  });
  const now = new Date();
  const offerIds = [...new Set(items.map((i) => i.offerId).filter((id): id is string => !!id))];
  const offers = offerIds.length
    ? await client.offer.findMany({
        where: { id: { in: offerIds }, tenantId },
        select: { id: true, tenantId: true, productId: true, status: true, agreedAmount: true, checkoutExpiresAt: true, orderId: true },
      })
    : [];
  const offerById = new Map(offers.map((o) => [o.id, o]));
  return items
    .filter((i) => i.product.tenantId === tenantId)
    .map(({ addedAt, offerId, product: p }) => {
      const offer = offerId ? offerById.get(offerId) : undefined;
      const applied = offerPriceApplies(offer, { tenantId, productId: p.id }, now);
      const hold = p.reservations[0] ?? null;
      const state = lineState({ status: p.status, quantity: p.quantity }, hold, cartId, now);
      const img = p.images[0];
      const manifest = (img?.variants ?? null) as { blur?: { dataUrl?: string } } | null;
      return {
        productId: p.id,
        stockCode: p.stockCode,
        slug: p.slug,
        title: p.title,
        price: applied ? offer!.agreedAmount! : p.price,
        listPrice: p.price,
        offerId: offerId ?? null,
        offerApplied: applied,
        offerExpired: Boolean(offerId) && !applied,
        weightGrams: p.weightGrams,
        imageUrl: img ? imageUrl(img.storageKey, "thumb") : null,
        imageAlt: img?.alt ?? null,
        blurDataUrl: manifest?.blur?.dataUrl ?? null,
        blurred: p.blurred,
        ageRestricted: p.ageRestricted,
        state,
        expiresAt: state === "held" || state === "taken" ? (hold?.expiresAt ?? null) : null,
        addedAt,
      };
    });
}

export function summarize(lines: CartLine[]) {
  const buyable = lines.filter((l) => l.state === "held" || l.state === "lapsed");
  const held = lines.filter((l) => l.state === "held" && l.expiresAt);
  return {
    subtotal: buyable.reduce((s, l) => s + l.price, 0),
    couponBase: buyable.filter((l) => !l.offerApplied).reduce((s, l) => s + l.price, 0),
    weightGrams: buyable.reduce((s, l) => s + l.weightGrams, 0),
    buyableCount: buyable.length,
    earliestExpiry: held.length ? new Date(Math.min(...held.map((l) => l.expiresAt!.getTime()))) : null,
  };
}

/**
 * The shop currency, memoised per request (React cache; outside a render it simply queries). Cart,
 * checkout context and quote all need it; it only changes through the platform admin.
 */
export const getTenantCurrency = cache(async (tenantId: string): Promise<string> => {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
  return tenant.currency;
});

/** Read-only cart view for the cart page / checkout / header. Null when there is no cart. */
export async function getCart(tenantId: string, token: string | null | undefined): Promise<CartView | null> {
  const cart = await findCart(tenantId, token);
  if (!cart) return null;
  const [lines, currency] = await Promise.all([loadLines(tenantId, cart.id), getTenantCurrency(tenantId)]);
  return {
    id: cart.id,
    currency,
    countryCode: cart.countryCode,
    customerId: cart.customerId,
    couponCode: cart.couponCode,
    email: cart.email,
    reminderConsent: cart.reminderConsent,
    lines,
    ...summarize(lines),
  };
}

/** Number of items in the cart (header badge). 0 when there is no cart. */
export async function cartItemCount(tenantId: string, token: string | null | undefined): Promise<number> {
  const cart = await findCart(tenantId, token);
  if (!cart) return 0;
  return db.cartItem.count({ where: { tenantId, cartId: cart.id } });
}

export type AddToCartResult =
  | { ok: true; expiresAt: Date; alreadyInCart: boolean }
  | { ok: false; code: "RESERVED"; minutes: number; message: string }
  | { ok: false; code: "UNAVAILABLE" | "LOGIN_REQUIRED" | "NOT_FOUND"; message: string };

export function reservedMessage(minutes: number): string {
  return `Someone else has this in their cart — try again in ${minutes} min`;
}

/**
 * Adds a (unique) product to the cart and reserves it. Creates the cart when there is none yet; the
 * caller must then store `token` in the `qm_cart` cookie. Business refusals are returned as
 * `{ ok: false }` (not thrown) so the UI can show them; malformed input throws INVALID.
 */
export async function addToCart(
  tenantId: string,
  token: string | null | undefined,
  productId: string,
  viewer: ShopViewer | null = null,
  /** Internal (offers): the line is bought at this accepted offer's agreed price. Validated by the caller. */
  opts: { offerId?: string } = {},
): Promise<{ token: string | null; result: AddToCartResult }> {
  const pid = productIdSchema.parse(productId);
  const [checkout, legal] = await Promise.all([getSettings(tenantId, "checkout"), getSettings(tenantId, "legal")]);

  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: pid, tenantId },
      select: { id: true, status: true, quantity: true, blurred: true },
    });
    if (!product) return { token: null, result: { ok: false, code: "NOT_FOUND", message: "This item could not be found" } };
    if (product.status !== "ACTIVE" || product.quantity <= 0) {
      return { token: null, result: { ok: false, code: "UNAVAILABLE", message: "This item is no longer available" } };
    }
    if (product.blurred && legal.blurSensitiveForGuests && !viewer) {
      return { token: null, result: { ok: false, code: "LOGIN_REQUIRED", message: "Log in to buy this item" } };
    }

    let cart = await lockCart(tx, tenantId, token);
    let newToken: string | null = null;
    if (!cart) {
      const created = await createCart(tx, tenantId, viewer);
      cart = created.cart;
      newToken = created.token;
    }

    try {
      const reservation = await reserveProduct({ tenantId, productId: pid, cartId: cart.id, minutes: checkout.reservationMinutes }, tx);
      const existing = await tx.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId: pid } }, select: { id: true } });
      if (!existing) await tx.cartItem.create({ data: { tenantId, cartId: cart.id, productId: pid, quantity: 1, offerId: opts.offerId ?? null } });
      else if (opts.offerId) await tx.cartItem.update({ where: { id: existing.id }, data: { offerId: opts.offerId } });
      await tx.cart.update({
        where: { id: cart.id },
        data: { expiresAt: cartExpiry(), ...(viewer?.customerId && !cart.customerId ? { customerId: viewer.customerId } : {}) },
      });
      return { token: newToken, result: { ok: true, expiresAt: reservation.expiresAt, alreadyInCart: Boolean(existing) } };
    } catch (err) {
      if (err instanceof ServiceError && err.code === "CONFLICT") {
        const until = (err.details as { expiresAt?: Date | null } | undefined)?.expiresAt ?? null;
        if (until) {
          const minutes = minutesUntil(until);
          // A brand-new cart that got nothing is kept (cheap) so the cookie stays stable for retries.
          return { token: newToken, result: { ok: false, code: "RESERVED", minutes, message: reservedMessage(minutes) } };
        }
        return { token: newToken, result: { ok: false, code: "UNAVAILABLE", message: "This item is no longer available" } };
      }
      throw err;
    }
  });
}

/** Removes a product from the cart and releases this cart's hold on it. Idempotent. */
export async function removeFromCart(tenantId: string, token: string | null | undefined, productId: string): Promise<{ removed: boolean }> {
  const pid = productIdSchema.parse(productId);
  return db.$transaction(async (tx) => {
    const cart = await lockCart(tx, tenantId, token);
    if (!cart) return { removed: false };
    const del = await tx.cartItem.deleteMany({ where: { tenantId, cartId: cart.id, productId: pid } });
    // Only holds still owned by the cart (an order's holds have cartId = null and are untouched).
    await releaseReservation({ tenantId, productId: pid, cartId: cart.id }, tx);
    await tx.cart.update({ where: { id: cart.id }, data: { expiresAt: cartExpiry() } });
    return { removed: del.count > 0 };
  });
}

export type RefreshResult = { reReserved: string[]; taken: string[]; unavailable: string[] };

/**
 * Checkout start / "re-add": re-reserves every cart line whose hold lapsed while the product is still
 * free. Live holds are NOT extended (a cart can't keep an item forever by reloading); lines taken by
 * someone else or no longer for sale are reported. Optionally limited to one product.
 */
export async function extendReservations(tenantId: string, token: string | null | undefined, onlyProductId?: string): Promise<RefreshResult> {
  const only = onlyProductId === undefined ? undefined : productIdSchema.parse(onlyProductId);
  const checkout = await getSettings(tenantId, "checkout");
  return db.$transaction(async (tx) => {
    const out: RefreshResult = { reReserved: [], taken: [], unavailable: [] };
    const cart = await lockCart(tx, tenantId, token);
    if (!cart) return out;
    const lines = await loadLines(tenantId, cart.id, tx);
    for (const line of lines) {
      if (only && line.productId !== only) continue;
      if (line.state === "unavailable") out.unavailable.push(line.productId);
      else if (line.state === "taken") out.taken.push(line.productId);
      else if (line.state === "lapsed") {
        try {
          await reserveProduct({ tenantId, productId: line.productId, cartId: cart.id, minutes: checkout.reservationMinutes }, tx);
          out.reReserved.push(line.productId);
        } catch (err) {
          if (!(err instanceof ServiceError && err.code === "CONFLICT")) throw err;
          out.taken.push(line.productId);
        }
      }
    }
    await tx.cart.update({ where: { id: cart.id }, data: { expiresAt: cartExpiry() } });
    return out;
  });
}

/** Drops lines whose product was sold/unpublished (user-initiated cleanup from the cart page). */
export async function removeUnavailable(tenantId: string, token: string | null | undefined): Promise<number> {
  return db.$transaction(async (tx) => {
    const cart = await lockCart(tx, tenantId, token);
    if (!cart) return 0;
    const lines = await loadLines(tenantId, cart.id, tx);
    const ids = lines.filter((l) => l.state === "unavailable").map((l) => l.productId);
    if (!ids.length) return 0;
    const del = await tx.cartItem.deleteMany({ where: { tenantId, cartId: cart.id, productId: { in: ids } } });
    await tx.reservation.updateMany({
      where: { tenantId, cartId: cart.id, productId: { in: ids }, status: "ACTIVE" },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    return del.count;
  });
}

/** Remembers the shipping country chosen on the cart page (estimate only — checkout uses the address). */
export async function setCartCountry(tenantId: string, token: string | null | undefined, countryCode: string): Promise<void> {
  const code = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).parse(countryCode);
  const cart = await findCart(tenantId, token);
  if (!cart) return;
  await db.cart.update({ where: { id: cart.id }, data: { countryCode: code } });
}

/** Internal (checkout): cart lines inside the caller's transaction. */
export { loadLines as loadCartLinesTx };
