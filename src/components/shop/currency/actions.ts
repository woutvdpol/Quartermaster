"use server";

import { cookies } from "next/headers";
import { getRequestTenant } from "@/server/tenant";
import { CURRENCY_COOKIE, CURRENCY_OFF, getShopCurrencyOptions } from "@/server/rates/display";

/** Stores the visitor's indicative display currency (or "off"). Only offered currencies are accepted. */
export async function setDisplayCurrencyAction(currency: string): Promise<{ ok: boolean }> {
  const tenant = await getRequestTenant();
  if (!tenant || typeof currency !== "string") return { ok: false };
  const value = currency.toUpperCase();
  const jar = await cookies();
  if (value === CURRENCY_OFF.toUpperCase()) {
    jar.delete(CURRENCY_COOKIE);
    return { ok: true };
  }
  const options = await getShopCurrencyOptions(tenant.id);
  if (!options.rates.some((r) => r.currency === value)) return { ok: false };
  jar.set(CURRENCY_COOKIE, value, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
