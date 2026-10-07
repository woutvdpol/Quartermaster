import "server-only";
import { cookies } from "next/headers";
import { CART_COOKIE, CART_TTL_DAYS, cartItemCount } from "./index";

/** The raw cart token from the `qm_cart` cookie (validated/hashed by the cart service). */
export async function readCartToken(): Promise<string | null> {
  return (await cookies()).get(CART_COOKIE)?.value ?? null;
}

/** Stores a new cart token. Only callable from Server Actions / Route Handlers. */
export async function writeCartToken(token: string): Promise<void> {
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CART_TTL_DAYS * 24 * 60 * 60,
  });
}

/** Header badge: items in the visitor's cart for this tenant (0 without a cart). */
export async function currentCartCount(tenantId: string): Promise<number> {
  return cartItemCount(tenantId, await readCartToken());
}
