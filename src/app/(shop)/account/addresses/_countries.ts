import "server-only";
import { db } from "@/server/db";
import { COUNTRIES, COUNTRY_CODES, isCountryCode } from "@/server/shipping/countries";

/** Country options for the address form: countries the shop ships to first, then every country. */
export async function countryOptions(tenantId: string) {
  const zones = await db.shippingZone.findMany({
    where: { tenantId, isActive: true, isPickup: false },
    orderBy: { sortOrder: "asc" },
    select: { countries: true },
  });
  const preferred = [...new Set(zones.flatMap((z) => z.countries))].filter(isCountryCode).slice(0, 40);
  const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], "en");
  return {
    /** First country of the first delivery zone (usually the shop's home country). */
    defaultCountry: (zones[0]?.countries.find(isCountryCode) as string | undefined) ?? preferred[0] ?? "NL",
    preferred: preferred.map((c) => [c, COUNTRIES[c]] as [string, string]).sort(byName),
    all: COUNTRY_CODES.map((c) => [c, COUNTRIES[c]] as [string, string]).sort(byName),
  };
}
