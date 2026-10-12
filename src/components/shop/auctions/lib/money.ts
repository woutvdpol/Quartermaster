import { currencyExponent } from "@/components/shop/ui/money";
import { INTL_LOCALE, type ShopLocale } from "@/lib/i18n/shop-locales";

/*
 * Amount input for bids. Pure (client + server). Visitors type amounts the way their language writes
 * them — "1450", "1.450", "1,450", "1.450,50", "1,450.50", "€ 1 450", "1450,-" — and the parser
 * accepts all of them regardless of the page language: a separator followed by exactly three digits
 * groups thousands, one followed by one or two digits marks the decimals (bids never have three
 * decimals, so this is unambiguous).
 */

const MAX_MINOR = 1_000_000_000; // 10 million in a 2-decimal currency

/** Raw input → minor units of `currency`, or null when unreadable / not positive. */
export function parseMoneyInput(raw: string, currency = "EUR"): number | null {
  if (typeof raw !== "string") return null;
  // Currency symbols/codes, spaces (incl. narrow/no-break), apostrophes and a trailing ",-" / ".-".
  const s = raw
    .trim()
    .replace(/[.,]-$/, "")
    .replace(/[\s  '’]/g, "")
    .replace(/^[^\d.,-]+|[^\d.,]+$/g, "");
  if (!s || /[^\d.,]/.test(s)) return null;
  if (!/\d/.test(s)) return null;
  const exp = currencyExponent(currency);
  const seps = [...s.matchAll(/[.,]/g)].map((m) => ({ ch: m[0], at: m.index ?? 0 }));
  let intPart = s;
  let fracPart = "";
  if (seps.length) {
    const last = seps[seps.length - 1];
    const after = s.length - last.at - 1;
    let grouping = seps;
    if (after === 1 || after === 2) {
      // Decimal mark: "1450,5", "1.450,50", "1,450.50".
      intPart = s.slice(0, last.at);
      fracPart = s.slice(last.at + 1);
      grouping = seps.slice(0, -1);
      if (grouping.some((g) => g.ch === last.ch)) return null; // "1,450,50"
    } else if (after === 0) {
      if (seps.length > 1) return null;
      intPart = s.slice(0, -1); // "1450."
      grouping = [];
    } else if (after !== 3) {
      return null;
    }
    // Thousands separators: one kind, every group after the first exactly three digits ("1.4.50" is a typo).
    if (grouping.length) {
      if (new Set(grouping.map((g) => g.ch)).size > 1) return null;
      const groups = intPart.split(grouping[0].ch);
      if (groups[0] === "" || groups[0].length > 3 || groups.slice(1).some((g) => g.length !== 3)) return null;
      intPart = groups.join("");
    }
  }
  if (!/^\d+$/.test(intPart) || (fracPart && !/^\d+$/.test(fracPart))) return null;
  if (exp === 0 && fracPart && /[1-9]/.test(fracPart)) return null;
  const minor = Number(intPart) * 10 ** exp + (exp ? Math.round(Number(`0.${fracPart || "0"}`) * 10 ** exp) : 0);
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_MINOR) return null;
  return minor;
}

const inputFormats = new Map<string, Intl.NumberFormat>();

/** Minor units → the input's text in the page language, without symbol: 145000 → "1,450" (en) · "1.450" (nl/de). */
export function formatMoneyInput(minor: number, locale: ShopLocale, currency = "EUR"): string {
  const exp = currencyExponent(currency);
  const value = minor / 10 ** exp;
  const whole = Number.isInteger(value);
  const key = `${locale}:${whole ? 0 : exp}`;
  let f = inputFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits: whole ? 0 : exp, maximumFractionDigits: whole ? 0 : exp });
    inputFormats.set(key, f);
  }
  return f.format(value);
}

const displayFormats = new Map<string, Intl.NumberFormat>();

/**
 * Auction amounts as shown: whole amounts without decimals ("€1,450", "€ 1.450", "1.450 €"), others
 * with the currency's decimals. Bids are almost always whole; ".00" everywhere is noise.
 */
export function formatBidMoney(minor: number, currency: string, locale: ShopLocale): string {
  const exp = currencyExponent(currency);
  const value = minor / 10 ** exp;
  const whole = Number.isInteger(value);
  const key = `${locale}:${currency}:${whole}`;
  let f = displayFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency, ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) });
    displayFormats.set(key, f);
  }
  return f.format(value);
}
