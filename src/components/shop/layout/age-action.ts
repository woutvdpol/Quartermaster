"use server";

import { cookies } from "next/headers";
import { AGE_COOKIE, AGE_COOKIE_MAX_AGE } from "@/server/storefront/age";
import { getShopContext, isLocalHost } from "@/server/storefront/context";

/** Stores the visitor's age confirmation for this shop (host-only cookie). */
export async function confirmAge(): Promise<{ ok: boolean }> {
  const shop = await getShopContext();
  if (!shop) return { ok: false };
  (await cookies()).set(AGE_COOKIE, String(shop.settings.legal.minimumAge), {
    httpOnly: true,
    sameSite: "lax",
    secure: !isLocalHost(shop.host),
    path: "/",
    maxAge: AGE_COOKIE_MAX_AGE,
  });
  return { ok: true };
}
