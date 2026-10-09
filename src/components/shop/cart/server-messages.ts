import type { ShopLocale } from "@/lib/i18n/shop-locales";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { currencyExponent, formatMoney } from "@/components/shop/ui/money";
import { offerCopies, offerCopy } from "@/components/shop/offers/_copy";
import { cartCopies, cartCopy } from "./_copy";
import { localizeEnglishCountryName } from "./countries";

/*
 * The cart, checkout, coupon, payment and offer services (src/server/…) return English messages.
 * The shop shows them in the visitor's language through this mapping: exact texts by key, texts with
 * values (minutes, titles, amounts) by pattern. Unknown messages are shown as they are (English).
 * Pure: used by server actions and by client components (quote messages).
 */

type Strings<T> = { [K in keyof T as T[K] extends string ? K : never]: T[K] };

function stringKeys<T extends object>(o: T): (keyof Strings<T>)[] {
  return (Object.keys(o) as (keyof T)[]).filter((k) => typeof o[k] === "string") as (keyof Strings<T>)[];
}

type Lookup = (locale: ShopLocale) => string;

let exact: Map<string, Lookup> | null = null;

function exactMap(): Map<string, Lookup> {
  if (exact) return exact;
  const m = new Map<string, Lookup>();
  for (const k of stringKeys(cartCopy.errors)) m.set(cartCopy.errors[k], (l) => pickCopy(cartCopies, l).errors[k]);
  for (const k of stringKeys(offerCopy.errors)) if (!m.has(offerCopy.errors[k])) m.set(offerCopy.errors[k], (l) => pickCopy(offerCopies, l).errors[k]);
  // Texts the actions share with the UI copy.
  m.set(cartCopy.checkout.rateLimited, (l) => pickCopy(cartCopies, l).checkout.rateLimited);
  m.set(cartCopy.checkout.unexpected, (l) => pickCopy(cartCopies, l).checkout.unexpected);
  m.set(cartCopy.coupon.rateLimited, (l) => pickCopy(cartCopies, l).coupon.rateLimited);
  m.set(offerCopy.invalidAmount, (l) => pickCopy(offerCopies, l).invalidAmount);
  exact = m;
  return m;
}

const many = (word: string) => word === "them" || word === "are";

const PATTERNS: [RegExp, (m: RegExpExecArray, l: ShopLocale) => string][] = [
  [/^Someone else has this in their cart — try again in (\d+) min$/, (m, l) => pickCopy(cartCopies, l).errors.reservedByOther(Number(m[1]))],
  [/^Use at most (\d+) characters$/, (m, l) => pickCopy(cartCopies, l).errors.maxChars(Number(m[1]))],
  [/^Please confirm you are at least (\d+) years old$/, (m, l) => pickCopy(cartCopies, l).errors.age(Number(m[1]))],
  [/^No longer available: (.+)\. Remove (them|it) from your cart to continue\.$/, (m, l) => pickCopy(cartCopies, l).errors.noLongerAvailable(m[1], many(m[2]))],
  [
    /^Can't be shipped to (.+?) \(local regulations\): (.+)\. Remove (them|it) from your cart or choose pickup\.$/,
    (m, l) => pickCopy(cartCopies, l).errors.restricted(localizeEnglishCountryName(m[1], l), m[2], many(m[3])),
  ],
  [/^(.+) \(([^()]+)\)\. Remove the code in your cart to continue\.$/, (m, l) => pickCopy(cartCopies, l).errors.couponRefused(localizeServerMessage(m[1], l), m[2])],
  [/^This code needs a subtotal of at least (.+)$/, (m, l) => pickCopy(cartCopies, l).errors.couponMinSubtotal(m[1])],
  [/^Sorry — (.+) (are|is) no longer available, so this order can't be paid\.$/, (m, l) => pickCopy(cartCopies, l).errors.retryUnavailable(m[1], many(m[2]))],
  [
    /^The lowest offer we can consider is (\d+(?:\.\d+)?) ([A-Z]{3})$/,
    (m, l) => pickCopy(offerCopies, l).errors.lowest(formatMoney(Math.round(Number(m[1]) * 10 ** currencyExponent(m[2])), m[2], l)),
  ],
];

/** A service message in the shop language (English unchanged). */
export function localizeServerMessage(message: string, locale: ShopLocale): string {
  if (locale === "en" || !message) return message;
  const hit = exactMap().get(message);
  if (hit) return hit(locale);
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(message);
    if (m) return fn(m, locale);
  }
  return message;
}

/** Field errors ({ "shipping.city": "Enter your city" }) in the shop language. */
export function localizeFieldErrors<E extends Record<string, string> | undefined>(errors: E, locale: ShopLocale): E {
  if (!errors || locale === "en") return errors;
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, localizeServerMessage(v, locale)])) as E;
}
