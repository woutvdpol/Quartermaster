/*
 * Money helpers. Amounts are integers in minor units (cents) in the tenant currency (Tenant.currency).
 * Plain module: safe in server actions and client components.
 */

/** Locale for number/date formatting in the admin. "en-NL" gives "€1,234.50". */
export const DEFAULT_FORMAT_LOCALE = "en-NL";
export const DEFAULT_CURRENCY = "EUR";

const digitsCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (EUR 2, JPY 0). */
export function currencyDigits(currency: string): number {
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    digitsCache.set(currency, digits);
  }
  return digits;
}

/** Format minor units as currency, e.g. formatMoney(123450, "EUR") → "€1,234.50". */
export function formatMoney(
  minor: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_FORMAT_LOCALE,
  options: Intl.NumberFormatOptions = {},
): string {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency, ...options }).format(minor / 10 ** digits);
}

/** Format minor units as a plain number for an input ("1,234.50" in en-NL, "1.234,50" in nl-NL). */
export function formatMoneyInput(minor: number, currency: string = DEFAULT_CURRENCY, locale: string = DEFAULT_FORMAT_LOCALE): string {
  const digits = currencyDigits(currency);
  // Use the currency formatter (minus the symbol) so separators match <Money> for the same locale.
  return new Intl.NumberFormat(locale, { style: "currency", currency })
    .formatToParts(minor / 10 ** digits)
    .filter((p) => p.type !== "currency" && p.type !== "literal")
    .map((p) => p.value)
    .join("");
}

/** Currency symbol for a locale, e.g. "€". */
export function currencySymbol(currency: string = DEFAULT_CURRENCY, locale: string = DEFAULT_FORMAT_LOCALE): string {
  const part = new Intl.NumberFormat(locale, { style: "currency", currency })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? currency;
}

/**
 * Parse a typed amount into integer minor units. Accepts Dutch and English notation:
 * "12,50", "12.50", "1.234,56", "1,234.56", "1 234,56", "€ 12", "12,-". Returns null when the text
 * is not a valid amount or has more decimals than the currency allows. Exact (string based, no floats).
 */
export function parseMoney(input: string, fractionDigits = 2): number | null {
  let s = input.replace(/[\s  ]/g, "");
  // Strip one leading/trailing currency symbol or ISO code ("€12", "12 EUR"); anything else is invalid.
  s = s.replace(/^-?(\p{Sc}|[A-Za-z]{3})/u, (m) => (m.startsWith("-") ? "-" : "")).replace(/(\p{Sc}|[A-Za-z]{3})$/u, "");
  s = s.replace(/[.,]-$/, ""); // Dutch "12,-"
  let negative = false;
  if (/^[+-]/.test(s)) {
    negative = s[0] === "-";
    s = s.slice(1);
  }
  if (!s || !/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  let intPart = s;
  let fracPart = "";
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalIdx = Math.max(lastDot, lastComma);
    const group = s[decimalIdx] === "." ? "," : ".";
    intPart = s.slice(0, decimalIdx);
    fracPart = s.slice(decimalIdx + 1);
    if (/[.,]/.test(fracPart) || intPart.includes(s[decimalIdx])) return null;
    if (!validGrouping(intPart, group)) return null;
    intPart = intPart.split(group).join("");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = s.split(sep);
    const after = parts[parts.length - 1];
    const looksGrouped = parts.length > 2 || (after.length === 3 && fractionDigits !== 3 && !/^0/.test(parts[0]));
    if (looksGrouped) {
      if (!validGrouping(s, sep)) return null;
      intPart = parts.join("");
    } else {
      intPart = parts[0];
      fracPart = after;
    }
  }
  if (intPart === "") intPart = "0";
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart) || fracPart.length > fractionDigits) return null;
  const minor = Number(intPart + fracPart.padEnd(fractionDigits, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

function validGrouping(s: string, sep: string): boolean {
  const groups = s.split(sep);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}
