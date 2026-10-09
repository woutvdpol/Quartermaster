import "server-only";
import { db } from "@/server/db";
import { COUNTRY_CODES, isCountryCode } from "@/server/shipping/countries";
import { localCountryName } from "@/components/shop/account/format";
import { INTL_LOCALE, type ShopLocale } from "@/lib/i18n/shop-locales";

/** Country options for the address form (names in the shop language): countries the shop ships to first, then every country. */
export async function countryOptions(tenantId: string, locale: ShopLocale) {
  const zones = await db.shippingZone.findMany({
    where: { tenantId, isActive: true, isPickup: false },
    orderBy: { sortOrder: "asc" },
    select: { countries: true },
  });
  const preferred = [...new Set(zones.flatMap((z) => z.countries))].filter(isCountryCode).slice(0, 40);
  const collator = new Intl.Collator(INTL_LOCALE[locale]);
  const byName = (a: [string, string], b: [string, string]) => collator.compare(a[1], b[1]);
  const named = (c: string) => [c, localCountryName(c, locale)] as [string, string];
  return {
    /** First country of the first delivery zone (usually the shop's home country). */
    defaultCountry: (zones[0]?.countries.find(isCountryCode) as string | undefined) ?? preferred[0] ?? "NL",
    preferred: preferred.map(named).sort(byName),
    all: COUNTRY_CODES.map(named).sort(byName),
  };
}
