/**
 * Money formatting for the storefront. Pure (usable on server and client).
 * Amounts are integer minor units of `currency` (tenant currency, see Tenant.currency).
 */

/** Locale used for number formatting in the shop UI (English copy; € 1,450.00 style). */
export const SHOP_LOCALE = "en-IE";

const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP", "VND", "ISK", "HUF"]);

/** Minor-unit exponent of a currency (JPY = 0, EUR = 2). */
export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(currency: string, maxFraction?: number): Intl.NumberFormat {
  const key = `${currency}:${maxFraction ?? "d"}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(SHOP_LOCALE, {
      style: "currency",
      currency,
      ...(maxFraction !== undefined ? { minimumFractionDigits: 0, maximumFractionDigits: maxFraction } : {}),
    });
    formatters.set(key, f);
  }
  return f;
}

/** `formatMoney(145000, "EUR")` → "€1,450.00". */
export function formatMoney(cents: number, currency: string): string {
  return formatter(currency).format(cents / 10 ** currencyExponent(currency));
}

/**
 * Indicative conversion for display only (decision 17: checkout is always in the shop currency).
 * `rate` = units of `to` per 1 unit of `from`. Rounded to whole units: "≈ £1,262".
 */
export function formatIndicative(cents: number, from: string, to: string, rate: number): string | null {
  if (!(rate > 0) || !Number.isFinite(rate)) return null;
  const amount = (cents / 10 ** currencyExponent(from)) * rate;
  return formatter(to, 0).format(Math.round(amount));
}
