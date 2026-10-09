import type { Address } from "@/generated/prisma/client";
import type { ShopLocale } from "@/lib/i18n/shop-locales";
import { localCountryName } from "./format";

/** Postal address block. */
export function AddressLines({
  a,
  locale,
}: {
  locale: ShopLocale;
  a: Pick<Address, "firstName" | "lastName" | "company" | "street" | "houseNumber" | "line2" | "postalCode" | "city" | "region" | "countryCode" | "phone">;
}) {
  return (
    <address className="text-sm leading-6 text-shop-ink-2 not-italic">
      <span className="block font-medium text-shop-ink">
        {a.firstName} {a.lastName}
      </span>
      {a.company ? <span className="block">{a.company}</span> : null}
      <span className="block">
        {a.street}
        {a.houseNumber ? ` ${a.houseNumber}` : ""}
      </span>
      {a.line2 ? <span className="block">{a.line2}</span> : null}
      <span className="block">
        {[a.postalCode, a.city].filter(Boolean).join(" ")}
        {a.region ? `, ${a.region}` : ""}
      </span>
      <span className="block">{localCountryName(a.countryCode, locale)}</span>
      {a.phone ? <span className="block">{a.phone}</span> : null}
    </address>
  );
}
