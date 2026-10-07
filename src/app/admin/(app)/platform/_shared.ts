import type { StatusTone } from "@/components/admin/ui";

export type TenantStatusValue = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export const STATUS_LABEL: Record<TenantStatusValue, string> = { ACTIVE: "Active", SUSPENDED: "Suspended", ARCHIVED: "Archived" };
export const STATUS_TONE: Record<TenantStatusValue, StatusTone> = { ACTIVE: "ok", SUSPENDED: "warn", ARCHIVED: "mute" };

export const STATUS_EFFECT: Record<TenantStatusValue, string> = {
  ACTIVE: "The shop and its admin are reachable again on its domains.",
  SUSPENDED: "The shop and its admin stop resolving on its domains, and every owner and customer is signed out. Data is kept; you can reactivate it later.",
  ARCHIVED: "Like suspended, but marks the shop as closed for good. Every owner and customer is signed out. Data is kept; you can still reactivate it.",
};

export const COMMON_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "AUD", "CAD", "NZD", "JPY"];

/** IANA time zones grouped by region for a Select. */
export function timeZoneOptions(): { label: string; options: { value: string; label: string }[] }[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = ["Europe/Amsterdam", "Europe/Brussels", "Europe/Berlin", "Europe/London", "UTC"];
  }
  if (!zones.includes("UTC")) zones = [...zones, "UTC"];
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const z of zones) {
    const region = z.includes("/") ? z.slice(0, z.indexOf("/")) : "Other";
    const list = groups.get(region) ?? [];
    list.push({ value: z, label: z.replace(/_/g, " ") });
    groups.set(region, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, options]) => ({ label, options }));
}
