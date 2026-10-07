import { EU_COUNTRIES } from "@/server/shipping/countries";

/** Pure labels and presets for the compliance editor (client-safe). */

export const COMPLIANCE_MATCHES = ["CATEGORY", "RESTRICTED_SYMBOLS", "AGE_RESTRICTED", "DEACTIVATED_WEAPON"] as const;
export type ComplianceMatchName = (typeof COMPLIANCE_MATCHES)[number];

export const COMPLIANCE_ACTIONS = ["HIDE_PRODUCT", "BLUR_IMAGES", "NO_SHIPPING"] as const;
export type ComplianceActionName = (typeof COMPLIANCE_ACTIONS)[number];

export const MATCH_LABELS: Record<ComplianceMatchName, string> = {
  CATEGORY: "Category (incl. subcategories)",
  RESTRICTED_SYMBOLS: "Items with restricted symbols",
  AGE_RESTRICTED: "Age-restricted items",
  DEACTIVATED_WEAPON: "Deactivated weapons",
};

export const ACTION_LABELS: Record<ComplianceActionName, string> = {
  HIDE_PRODUCT: "Hide from the shop",
  BLUR_IMAGES: "Blur images",
  NO_SHIPPING: "Do not ship",
};

export type CountryPreset = { id: string; label: string; countries: readonly string[] };

export const COUNTRY_PRESETS: readonly CountryPreset[] = [
  { id: "de-at", label: "DE+AT (§86a)", countries: ["DE", "AT"] },
  { id: "fr", label: "France (R645-1)", countries: ["FR"] },
  { id: "eu", label: `EU (${EU_COUNTRIES.length})`, countries: EU_COUNTRIES },
];
