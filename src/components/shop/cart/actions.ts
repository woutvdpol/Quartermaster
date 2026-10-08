"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
// Not while the shop is "coming soon" (src/server/storefront/launch.ts).
import { getOpenShopTenant as getRequestTenant } from "@/server/storefront/launch";
import { clientIp } from "@/server/customer-auth/current";
import { take } from "@/server/auth/rate-limit";
import { readCartToken, writeCartToken } from "@/server/cart/cookie";
import {
  addToCart,
  cartItemCount,
  extendReservations,
  findCart,
  getShopViewer,
  removeFromCart,
  removeUnavailable,
  setCartCountry,
} from "@/server/cart";
import { db } from "@/server/db";
import { quoteCheckout, type CheckoutQuote } from "@/server/checkout";
import { applyCartCoupon, removeCartCoupon, restoreCart, setCartContact } from "@/server/cart/extras";

/*
 * Cart server actions, shared by the product page (AddToCartButton), the header and the cart page.
 * The tenant always comes from the request host; the cart from the httpOnly cookie. No client input
 * other than a product id / country code is used.
 */

const ADD_RULE = { limit: 60, windowMs: 10 * 60 * 1000 };

async function requireTenantId(): Promise<string> {
  const tenant = await getRequestTenant();
  if (!tenant) throw new Error("No shop on this host");
  return tenant.id;
}

export type AddToCartState =
  | { ok: true; count: number; expiresAt: string; alreadyInCart: boolean }
  | { ok: false; code: "RESERVED" | "UNAVAILABLE" | "LOGIN_REQUIRED" | "NOT_FOUND" | "RATE_LIMITED" | "ERROR"; message: string; count?: number };

export async function addToCartAction(productId: unknown): Promise<AddToCartState> {
  if (typeof productId !== "string" || productId.length > 64) return { ok: false, code: "NOT_FOUND", message: "This item could not be found" };
  const tenantId = await requireTenantId();
  const limitKey = `cart.add:${tenantId}:${(await clientIp()) ?? "unknown"}`;
  if (!(await take(limitKey, ADD_RULE))) return { ok: false, code: "RATE_LIMITED", message: "Too many attempts. Please wait a moment." };

  const viewer = await getShopViewer(tenantId);
  const token = await readCartToken();
  const { token: newToken, result } = await addToCart(tenantId, token, productId, viewer);
  if (newToken) await writeCartToken(newToken);
  const count = await cartItemCount(tenantId, newToken ?? token);
  revalidatePath("/cart");
  if (result.ok) return { ok: true, count, expiresAt: result.expiresAt.toISOString(), alreadyInCart: result.alreadyInCart };
  return { ok: false, code: result.code, message: result.message, count };
}

/** useActionState-compatible variant (works as a plain form POST before hydration). */
export async function addToCartFormAction(_prev: AddToCartState | null, form: FormData): Promise<AddToCartState> {
  return addToCartAction(form.get("productId"));
}

export type CartLineStatus ={ inCart: boolean; held: boolean; expiresAt: string | null };

/** Read-only: is this product in the visitor's cart, and is the hold still live? */
export async function cartLineStatusAction(productId: unknown): Promise<CartLineStatus> {
  const none = { inCart: false, held: false, expiresAt: null };
  if (typeof productId !== "string" || productId.length > 64) return none;
  const tenantId = await requireTenantId();
  const cart = await findCart(tenantId, await readCartToken());
  if (!cart) return none;
  const item = await db.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId } }, select: { id: true } });
  if (!item) return none;
  const hold = await db.reservation.findFirst({
    where: { tenantId, productId, cartId: cart.id, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { expiresAt: true },
  });
  return { inCart: true, held: Boolean(hold), expiresAt: hold?.expiresAt.toISOString() ?? null };
}

function productIdFrom(form: FormData): string | null {
  const v = form.get("productId");
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}

export async function removeFromCartAction(form: FormData): Promise<void> {
  const tenantId = await requireTenantId();
  const pid = productIdFrom(form);
  if (pid) await removeFromCart(tenantId, await readCartToken(), pid);
  revalidatePath("/cart");
}

export async function reReserveAction(form: FormData): Promise<void> {
  const tenantId = await requireTenantId();
  const pid = productIdFrom(form);
  if (pid) await extendReservations(tenantId, await readCartToken(), pid);
  revalidatePath("/cart");
  revalidatePath("/checkout");
}

export async function removeUnavailableAction(): Promise<void> {
  const tenantId = await requireTenantId();
  await removeUnavailable(tenantId, await readCartToken());
  revalidatePath("/cart");
  revalidatePath("/checkout");
}

/** "Continue to checkout" without JS: re-reserves lapsed-but-free items, then a real 303 to /checkout. */
export async function startCheckoutAction(): Promise<void> {
  const tenantId = await requireTenantId();
  await extendReservations(tenantId, await readCartToken());
  redirect("/checkout");
}

/**
 * Same, for the hydrated button (which navigates client-side). Redirecting to an app path from a
 * JS-invoked action makes Next render the target via an internal fetch to the server's own origin,
 * which loses the shop host (→ 404) — so the client navigates instead.
 */
export async function prepareCheckoutAction(): Promise<void> {
  const tenantId = await requireTenantId();
  await extendReservations(tenantId, await readCartToken());
}

/** Cart page shipping estimate for a country (remembered on the cart). */
export async function cartEstimateAction(countryCode: unknown): Promise<CheckoutQuote | null> {
  if (typeof countryCode !== "string" || !/^[A-Za-z]{2}$/.test(countryCode)) return null;
  const tenantId = await requireTenantId();
  const token = await readCartToken();
  await setCartCountry(tenantId, token, countryCode);
  return quoteCheckout(tenantId, token, { countryCode });
}

// ─── Coupon, checkout contact, restore (phase 5) ───────────────────────────

const COUPON_RULE = { limit: 20, windowMs: 10 * 60 * 1000 };
const CONTACT_RULE = { limit: 60, windowMs: 10 * 60 * 1000 };

export type CouponFormState = { ok: boolean; message: string } | null;

/** Apply a discount code to the cart (rate limited: codes must not be brute-forced). */
export async function applyCouponAction(_prev: CouponFormState, form: FormData): Promise<CouponFormState> {
  const code = form.get("couponCode");
  if (typeof code !== "string" || !code.trim()) return { ok: false, message: "Enter a code" };
  const tenantId = await requireTenantId();
  const key = `cart.coupon:${tenantId}:${(await clientIp()) ?? "unknown"}`;
  if (!(await take(key, COUPON_RULE))) return { ok: false, message: "Too many attempts. Please wait a few minutes." };
  const res = await applyCartCoupon(tenantId, await readCartToken(), code);
  revalidatePath("/cart");
  revalidatePath("/checkout");
  return res.ok ? { ok: true, message: `Code ${res.outcome.code} applied` } : { ok: false, message: res.message };
}

export async function removeCouponAction(): Promise<void> {
  const tenantId = await requireTenantId();
  await removeCartCoupon(tenantId, await readCartToken());
  revalidatePath("/cart");
  revalidatePath("/checkout");
}

/**
 * Checkout: remembers the email (on blur) and the "remind me" consent on the cart. A signed-in
 * customer's account email is used instead of the typed one.
 */
export async function saveCheckoutContactAction(input: { email?: unknown; reminderConsent?: unknown }): Promise<void> {
  const tenantId = await requireTenantId();
  const key = `cart.contact:${tenantId}:${(await clientIp()) ?? "unknown"}`;
  if (!(await take(key, CONTACT_RULE))) return;
  const viewer = await getShopViewer(tenantId);
  await setCartContact(tenantId, await readCartToken(), {
    email: viewer ? viewer.email : typeof input?.email === "string" ? input.email.slice(0, 254) : undefined,
    reminderConsent: typeof input?.reminderConsent === "boolean" ? input.reminderConsent : undefined,
  });
}

/** "Back to your cart" (reminder mail): POST only — mail scanners follow GET links. */
export async function restoreCartAction(restoreToken: unknown): Promise<{ ok: boolean }> {
  const tenantId = await requireTenantId();
  const key = `cart.restore:${tenantId}:${(await clientIp()) ?? "unknown"}`;
  if (!(await take(key, COUPON_RULE))) return { ok: false };
  const restored = await restoreCart(tenantId, restoreToken);
  if (!restored) return { ok: false };
  await writeCartToken(restored.token);
  await extendReservations(tenantId, restored.token);
  revalidatePath("/cart");
  return { ok: true };
}
