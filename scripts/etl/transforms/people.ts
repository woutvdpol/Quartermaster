import { COUNTRIES, isCountryCode } from "../../../src/server/shipping/countries";

/** Placeholder country for addresses whose legacy free-text country could not be resolved. */
export const UNKNOWN_COUNTRY = "ZZ";

// Dutch/German/French names and common variants seen in Concept500 (free-text country fields).
const ALIASES: Record<string, string> = {
  nederland: "NL",
  "the netherlands": "NL",
  holland: "NL",
  niederlande: "NL",
  "pays-bas": "NL",
  belgie: "BE",
  "belgië": "BE",
  belgien: "BE",
  belgique: "BE",
  duitsland: "DE",
  deutschland: "DE",
  allemagne: "DE",
  frankrijk: "FR",
  luxemburg: "LU",
  oostenrijk: "AT",
  "österreich": "AT",
  zwitserland: "CH",
  schweiz: "CH",
  spanje: "ES",
  italie: "IT",
  "italië": "IT",
  polen: "PL",
  denemarken: "DK",
  zweden: "SE",
  noorwegen: "NO",
  "verenigd koninkrijk": "GB",
  engeland: "GB",
  england: "GB",
  uk: "GB",
  "great britain": "GB",
  "united kingdom": "GB",
  "verenigde staten": "US",
  usa: "US",
  "united states of america": "US",
  ierland: "IE",
  tsjechie: "CZ",
  "tsjechië": "CZ",
  czechia: "CZ",
  hongarije: "HU",
  griekenland: "GR",
  portugal: "PT",
  finland: "FI",
};

const BY_NAME = new Map<string, string>(Object.entries(COUNTRIES).map(([code, name]) => [name.toLowerCase(), code]));

/** Free-text legacy country ("Netherlands", "nl", "België") → ISO 3166-1 alpha-2, or null. */
export function toCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper.length === 2 && isCountryCode(upper)) return upper;
  if (upper === "UK") return "GB";
  const lower = s.toLowerCase().replace(/\s+/g, " ");
  return BY_NAME.get(lower) ?? ALIASES[lower] ?? ALIASES[lower.normalize("NFKD").replace(/[̀-ͯ]/g, "")] ?? null;
}

/** "Jan de Vries" → { firstName: "Jan", lastName: "de Vries" }; single word → lastName "". */
export function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const s = (full ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { firstName: "", lastName: "" };
  const i = s.indexOf(" ");
  return i < 0 ? { firstName: s, lastName: "" } : { firstName: s.slice(0, i), lastName: s.slice(i + 1) };
}

/**
 * Best-effort split of a one-line legacy address into street + house number:
 * "Kerkstraat 12a" → { street: "Kerkstraat", houseNumber: "12a" }; "12 Main Street" → number first.
 * Multi-line addresses keep the extra lines in `line2`. Anything unparsable stays in `street`.
 */
export function splitStreet(address: string | null | undefined): { street: string; houseNumber: string | null; line2: string | null } {
  const lines = (address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines[0] ?? "";
  const line2 = lines.length > 1 ? lines.slice(1).join(", ") : null;
  const trailing = /^(.*?[^\d\s,])[\s,]+(\d+(?:\s?[-/]?\s?[A-Za-z0-9]{1,4})?)$/.exec(first);
  if (trailing) return { street: trailing[1].trim(), houseNumber: trailing[2].replace(/\s+/g, ""), line2 };
  const leading = /^(\d+[A-Za-z]?)[\s,]+(.+)$/.exec(first);
  if (leading) return { street: leading[2].trim(), houseNumber: leading[1], line2 };
  return { street: first, houseNumber: null, line2 };
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | null | undefined): v is string {
  return !!v && UUID.test(v.trim());
}
