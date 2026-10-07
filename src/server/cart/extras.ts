import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { evaluateCoupon, normalizeCouponCode, type CouponOutcome } from "@/server/coupons";
import { formatMoney } from "@/components/shop/ui/money";
import { cartExpiry, findCart, getCart } from "./index";
import { verifyCartRestore } from "./restore-token";

/*
 * Cart extras (phase 5): coupon code, checkout contact (email + reminder consent) and restoring a cart
 * from the abandoned-cart mail. Tenant-scoped like the rest of the cart service.
 */

export type ApplyCouponResult = { ok: true; outcome: Extract<CouponOutcome, { ok: true }> } | { ok: false; message: string };

/**
 * Validates `code` against the cart (coupon base, the customer's email when known) and remembers it
 * on the cart. The code is evaluated again by every quote and, under a lock, at placement.
 */
export async function applyCartCoupon(tenantId: string, token: string | null | undefined, rawCode: string): Promise<ApplyCouponResult> {
  const code = normalizeCouponCode(String(rawCode ?? "").slice(0, 60));
  if (!code) return { ok: false, message: "Enter a code" };
  const cart = await getCart(tenantId, token);
  if (!cart || cart.lines.length === 0) return { ok: false, message: "Your cart is empty" };
  const outcome = await evaluateCoupon(tenantId, code, { subtotal: cart.couponBase, shippingPrice: 0, email: cart.email }, (n) => formatMoney(n, cart.currency));
  if (!outcome.ok) return { ok: false, message: outcome.message };
  await db.cart.update({ where: { id: cart.id }, data: { couponCode: outcome.code } });
  return { ok: true, outcome };
}

export async function removeCartCoupon(tenantId: string, token: string | null | undefined): Promise<void> {
  const cart = await findCart(tenantId, token);
  if (cart?.couponCode) await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
}

const contactSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
  reminderConsent: z.boolean().optional(),
});

/**
 * Checkout contact captured early (email on blur, the "remind me" checkbox). The abandoned-cart mail
 * is only ever sent with `reminderConsent` (explicit opt-in) — storing the email alone sends nothing.
 * Invalid emails are ignored (the field may be half-typed). Returns whether something was stored.
 */
export async function setCartContact(tenantId: string, token: string | null | undefined, input: { email?: unknown; reminderConsent?: unknown }): Promise<boolean> {
  const parsed = contactSchema.safeParse({
    email: typeof input.email === "string" && input.email.trim() ? input.email : undefined,
    reminderConsent: typeof input.reminderConsent === "boolean" ? input.reminderConsent : undefined,
  });
  if (!parsed.success) return false;
  const cart = await findCart(tenantId, token);
  if (!cart) return false;
  const data: { email?: string; reminderConsent?: boolean } = {};
  if (parsed.data.email !== undefined && parsed.data.email !== cart.email) data.email = parsed.data.email;
  if (parsed.data.reminderConsent !== undefined && parsed.data.reminderConsent !== cart.reminderConsent) data.reminderConsent = parsed.data.reminderConsent;
  if (Object.keys(data).length === 0) return false;
  await db.cart.update({ where: { id: cart.id }, data });
  return true;
}

/**
 * "Back to your cart" from the reminder mail: verifies the signed token, rotates the cart's cookie
 * token (the old cookie stops working) and returns the new one for the `qm_cart` cookie. Null when the
 * link is invalid/expired or the cart is gone. Items are not re-reserved here (the caller may).
 */
export async function restoreCart(tenantId: string, restoreToken: unknown): Promise<{ token: string; cartId: string } | null> {
  const cartId = verifyCartRestore(restoreToken);
  if (!cartId) return null;
  const token = generateToken();
  const res = await db.cart.updateMany({
    where: { id: cartId, tenantId, expiresAt: { gt: new Date() } },
    data: { tokenHash: hashToken(token), expiresAt: cartExpiry() },
  });
  return res.count === 1 ? { token, cartId } : null;
}
