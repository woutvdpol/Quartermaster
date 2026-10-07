import { SHOP_LOCALE } from "@/components/shop/ui/money";

/** "7 Oct 2026" in the shop's timezone. */
export function formatDate(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(SHOP_LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat(SHOP_LOCALE, { day: "numeric", month: "short", year: "numeric" }).format(d);
  }
}

export { countryName } from "@/server/shipping/countries";
