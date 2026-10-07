/*
 * Carrier presets for "Mark shipped". Pure (no server imports) so the admin board can fill in the
 * tracking link client-side. There is NO carrier API integration: these are public tracking pages.
 *
 * Template placeholders: {code} tracking number, {postcode} destination postal code (no spaces,
 * upper-case), {country} ISO country code of the destination. All values are URL-encoded.
 */

export type CarrierPreset = {
  id: "postnl" | "dhl" | "dpd" | "ups" | "bpost";
  name: string;
  template: string;
};

export const CARRIERS: readonly CarrierPreset[] = [
  { id: "postnl", name: "PostNL", template: "https://jouw.postnl.nl/track-and-trace/{code}-{country}-{postcode}" },
  { id: "dhl", name: "DHL", template: "https://www.dhl.com/nl-en/home/tracking/tracking-parcel.html?submit=1&tracking-id={code}" },
  { id: "dpd", name: "DPD", template: "https://tracking.dpd.de/status/en_US/parcel/{code}" },
  { id: "ups", name: "UPS", template: "https://www.ups.com/track?loc=en_NL&tracknum={code}" },
  { id: "bpost", name: "bpost", template: "https://track.bpost.cloud/btr/web/#/search?itemCode={code}&lang=en" },
];

export function findCarrier(nameOrId: string | null | undefined): CarrierPreset | undefined {
  if (!nameOrId) return undefined;
  const key = nameOrId.trim().toLowerCase();
  return CARRIERS.find((c) => c.id === key || c.name.toLowerCase() === key);
}

/**
 * Tracking link for a preset carrier, or null when the carrier is unknown, there is no tracking
 * number, or the template needs a postcode/country that is missing.
 */
export function trackingUrlFor(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
  destination: { postalCode?: string | null; countryCode?: string | null } = {},
): string | null {
  const preset = findCarrier(carrier);
  const code = trackingNumber?.trim().replace(/\s+/g, "");
  if (!preset || !code) return null;
  const postcode = (destination.postalCode ?? "").replace(/\s+/g, "").toUpperCase();
  const country = (destination.countryCode ?? "").trim().toUpperCase();
  if (preset.template.includes("{postcode}") && !postcode) return null;
  if (preset.template.includes("{country}") && !/^[A-Z]{2}$/.test(country)) return null;
  return preset.template
    .replace("{code}", encodeURIComponent(code))
    .replace("{postcode}", encodeURIComponent(postcode))
    .replace("{country}", encodeURIComponent(country));
}
