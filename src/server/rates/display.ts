import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import { getDisplayRates, type DisplayRates } from "./index";

/*
 * Which indicative currency a shop visitor sees next to prices.
 *
 * - The shop owner picks the offered currencies (`general.displayCurrencies`).
 * - The visitor picks one with the CurrencySwitcher (cookie `qm_currency`). No cookie, an unknown
 *   value or "off" → no indicative price (shop currency only). We deliberately don't guess from
 *   geo/Accept-Language: checkout is always in the shop currency and a wrong guess just adds noise.
 *
 * Usage (server components):
 *   const display = await getVisitorDisplayCurrency(tenant.id);   // DisplayCurrency | null
 *   <Price cents={…} currency={shopCurrency} display={display} />
 *   <ProductCard product={…} display={display} />
 */

export const CURRENCY_COOKIE = "qm_currency";
export const CURRENCY_OFF = "off";

/** Display rates per tenant, cached for an hour (rates change once a day). Tag: `tenant:{id}:rates`. */
const cachedRates = (tenantId: string) =>
  unstable_cache(
    async () => {
      const r = await getDisplayRates(tenantId);
      return { ...r, rateDate: r.rateDate ? r.rateDate.toISOString() : null };
    },
    ["display-rates", tenantId],
    { revalidate: 3600, tags: [`tenant:${tenantId}`, `tenant:${tenantId}:rates`, `tenant:${tenantId}:settings`] },
  )();

export type ShopCurrencyOptions = Omit<DisplayRates, "rateDate"> & { rateDate: string | null };

/** Offered display currencies with their rates (empty `rates` = switcher hidden). Cached. */
export const getShopCurrencyOptions = cache(async (tenantId: string): Promise<ShopCurrencyOptions> => cachedRates(tenantId));

/** The visitor's chosen display currency as the `display` prop of <Price>/<ProductCard>, or null. */
export const getVisitorDisplayCurrency = cache(async (tenantId: string): Promise<{ currency: string; rate: number } | null> => {
  const chosen = (await cookies()).get(CURRENCY_COOKIE)?.value?.toUpperCase();
  if (!chosen || chosen === CURRENCY_OFF.toUpperCase()) return null;
  const options = await getShopCurrencyOptions(tenantId);
  return options.rates.find((r) => r.currency === chosen) ?? null;
});
