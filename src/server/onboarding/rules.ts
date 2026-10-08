// Pure onboarding rules (no DB, no server-only): application validation, automated checks, tenant
// slug + subdomain derivation. Shared by the services, the forms and unit tests.
import { z } from "zod";
import { slugify } from "@/server/catalog/slug";
import { COUNTRIES, isCountryCode, type CountryCode } from "@/server/shipping/countries";

// ─── Application form ───────────────────────────────────────────────────────

export const CURRENT_PLATFORMS = ["woocommerce", "shopify", "concept500", "marketplaces"] as const;
export type CurrentPlatform = (typeof CURRENT_PLATFORMS)[number];

export const CURRENT_PLATFORM_LABELS: Record<CurrentPlatform, string> = {
  woocommerce: "WooCommerce",
  shopify: "Shopify",
  concept500: "Concept500",
  marketplaces: "Fairs / marketplaces only",
};

export const APPLICATION_LIMITS = { name: 120, shopName: 80, coc: 30, description: 2000, minDescription: 20 } as const;

/** Countries offered on the sign-up form (Europe first; the platform is EU-focused). */
export const SIGNUP_COUNTRIES: readonly CountryCode[] = [
  "NL", "BE", "LU", "DE", "FR", "GB", "AT", "CH", "DK", "SE", "NO", "FI", "IE", "IT", "ES", "PT", "PL", "CZ",
];

/** Chamber of Commerce / company registration number: letters, digits, spaces, dots, dashes, slashes. */
const cocInput = z
  .string()
  .trim()
  .max(APPLICATION_LIMITS.coc)
  .regex(/^[A-Za-z0-9 .\-/]*$/, "Use letters, digits, spaces or dashes only");

export const applicationSchema = z.object({
  applicantName: z.string().trim().min(2, "Enter your name.").max(APPLICATION_LIMITS.name),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  shopName: z.string().trim().min(2, "Enter a shop name.").max(APPLICATION_LIMITS.shopName),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => isCountryCode(c), "Choose a country."),
  cocNumber: cocInput.transform((s) => s || null),
  currentPlatform: z.enum(CURRENT_PLATFORMS, "Choose where you sell now."),
  description: z
    .string()
    .trim()
    .min(APPLICATION_LIMITS.minDescription, `Tell us a little more (at least ${APPLICATION_LIMITS.minDescription} characters).`)
    .max(APPLICATION_LIMITS.description),
  legalConsent: z.literal(true, "You must confirm that you only sell legal items."),
});
export type ApplicationInput = z.input<typeof applicationSchema>;
export type ApplicationData = z.output<typeof applicationSchema>;

export type ApplicationField = keyof ApplicationData;

/** Reads the sign-up form (field names = schema keys). */
export function applicationInputFromForm(formData: FormData): Record<string, unknown> {
  const s = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : "";
  };
  return {
    applicantName: s("applicantName"),
    email: s("email"),
    shopName: s("shopName"),
    country: s("country"),
    cocNumber: s("cocNumber"),
    currentPlatform: s("currentPlatform") || undefined,
    description: s("description"),
    legalConsent: formData.get("legalConsent") === "on",
  };
}

// ─── Automated checks ───────────────────────────────────────────────────────

export type CocCheck = "ok" | "invalid" | "missing" | "unchecked";

/**
 * Format of company registration numbers we know (no external lookups):
 * NL KvK 8 digits · BE KBO/BCE 10 digits starting 0/1 · LU RCS B + digits · DE Handelsregister HRA/HRB + digits ·
 * FR SIREN 9 / SIRET 14 digits · GB Companies House 8 characters · AT Firmenbuch FN + digits + letter ·
 * DK CVR 8 digits · IE CRO 5–6 digits. Other countries: "unchecked".
 */
const COC_PATTERNS: Partial<Record<CountryCode, RegExp>> = {
  NL: /^\d{8}$/,
  BE: /^[01]\d{9}$/,
  LU: /^B\d{1,6}$/,
  DE: /^HR[AB]\d{1,6}[A-Z]?$/,
  FR: /^(\d{9}|\d{14})$/,
  GB: /^([A-Z]{2}\d{6}|\d{8})$/,
  AT: /^(FN)?\d{1,6}[A-Z]$/,
  DK: /^\d{8}$/,
  IE: /^\d{5,6}$/,
};

/** Upper-case without spaces, dots, dashes and slashes ("0123.456.789" → "0123456789"). */
export function compactCoc(value: string): string {
  return value.replace(/[\s.\-/]/g, "").toUpperCase();
}

export function checkCocFormat(country: string, coc: string | null | undefined): CocCheck {
  const value = compactCoc(coc ?? "");
  if (!value) return "missing";
  const pattern = isCountryCode(country) ? COC_PATTERNS[country] : undefined;
  if (!pattern) return "unchecked";
  return pattern.test(value) ? "ok" : "invalid";
}

/** Well-known throw-away mail providers. A heuristic, not a blocklist: it only flags the application. */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la", "10minutemail.com",
  "10minutemail.net", "yopmail.com", "yopmail.fr", "tempmail.com", "temp-mail.org", "tempmail.net", "trashmail.com",
  "trashmail.de", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com",
  "mintemail.com", "mohmal.com", "emailondeck.com", "spamgourmet.com", "mailnesia.com", "tempr.email", "discard.email",
  "mytemp.email", "burnermail.io", "33mail.com", "spambox.us", "moakt.com", "tmpmail.org", "tmail.ws", "inboxkitten.com",
]);
const DISPOSABLE_HINTS = ["tempmail", "temp-mail", "10minute", "trashmail", "throwaway", "disposable", "mailinator", "guerrilla", "yopmail"];

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
}

export function isDisposableEmail(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Sub-domains of known providers (e.g. "x.mailinator.com").
  for (const d of DISPOSABLE_DOMAINS) if (domain.endsWith(`.${d}`)) return true;
  return DISPOSABLE_HINTS.some((h) => domain.includes(h));
}

/** Comparison key for shop names: slug without common company suffixes ("Concept Militaria B.V." ≈ "concept-militaria"). */
export function shopNameKey(name: string): string {
  return slugify(name)
    .split("-")
    .filter((w) => w && !["bv", "b", "v", "vof", "gmbh", "ltd", "llc", "sarl", "sprl", "nv", "the", "shop", "militaria"].includes(w))
    .join("-");
}

/** Stored in DealerApplication.checks. */
export type ApplicationChecks = {
  emailVerified: boolean;
  cocFormat: CocCheck;
  /** Another application or a shop owner already uses this e-mail. */
  duplicateEmail: boolean;
  /** Another application or shop has (nearly) the same name. */
  duplicateShopName: boolean;
  disposableEmail: boolean;
  checkedAt: string;
};

export function parseChecks(value: unknown): ApplicationChecks | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Partial<ApplicationChecks>;
  return {
    emailVerified: v.emailVerified === true,
    cocFormat: v.cocFormat === "ok" || v.cocFormat === "invalid" || v.cocFormat === "missing" ? v.cocFormat : "unchecked",
    duplicateEmail: v.duplicateEmail === true,
    duplicateShopName: v.duplicateShopName === true,
    disposableEmail: v.disposableEmail === true,
    checkedAt: typeof v.checkedAt === "string" ? v.checkedAt : "",
  };
}

export type CheckTone = "ok" | "warn" | "crit";
export type CheckSummaryItem = { key: keyof ApplicationChecks; label: string; tone: CheckTone };

/** Human summary of the checks, worst first (list column + detail panel). */
export function summarizeChecks(checks: ApplicationChecks | null): CheckSummaryItem[] {
  if (!checks) return [{ key: "checkedAt", label: "Not checked", tone: "warn" }];
  const items: CheckSummaryItem[] = [
    checks.emailVerified
      ? { key: "emailVerified", label: "Email verified", tone: "ok" }
      : { key: "emailVerified", label: "Email not verified", tone: "warn" },
    checks.cocFormat === "ok"
      ? { key: "cocFormat", label: "CoC format OK", tone: "ok" }
      : checks.cocFormat === "invalid"
        ? { key: "cocFormat", label: "CoC format invalid", tone: "crit" }
        : checks.cocFormat === "missing"
          ? { key: "cocFormat", label: "No CoC number", tone: "warn" }
          : { key: "cocFormat", label: "CoC not checked", tone: "warn" },
  ];
  if (checks.duplicateEmail) items.push({ key: "duplicateEmail", label: "Email already known", tone: "crit" });
  if (checks.duplicateShopName) items.push({ key: "duplicateShopName", label: "Similar shop name exists", tone: "warn" });
  if (checks.disposableEmail) items.push({ key: "disposableEmail", label: "Disposable email domain", tone: "crit" });
  const rank: Record<CheckTone, number> = { crit: 0, warn: 1, ok: 2 };
  return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

// ─── Tenant slug + subdomain ────────────────────────────────────────────────

/** Sub-domain labels a shop may never get (infrastructure / confusing names). */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www", "admin", "api", "app", "platform", "mail", "smtp", "imap", "pop", "ftp", "static", "cdn", "assets", "uploads",
  "status", "help", "support", "docs", "blog", "dev", "test", "staging", "demo", "login", "auth", "account", "billing",
  "dashboard", "quartermaster", "qm", "root", "ns1", "ns2", "mx",
]);

export const TENANT_SLUG_MAX = 40;

/** Tenant slug candidate from a shop name: DNS-safe label, 2–40 chars, not reserved. */
export function baseTenantSlug(shopName: string): string {
  let slug = slugify(shopName, TENANT_SLUG_MAX);
  if (slug.length < 2) slug = slug ? `${slug}-shop` : "shop";
  if (RESERVED_SUBDOMAINS.has(slug)) slug = `${slug}-shop`;
  return slug;
}

/** First of `base`, `base-2`, `base-3`, … that is not in `taken`. */
export function nextFreeTenantSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, TENANT_SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("No free tenant slug");
}

/**
 * Base host for platform sub-domains (`<slug>.<base>`), from SHOP_SUBDOMAIN_BASE. Development default
 * "localhost:3000" → "<slug>.localhost:3000" (browsers resolve *.localhost to 127.0.0.1).
 */
export function shopSubdomainBase(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.SHOP_SUBDOMAIN_BASE ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^\.+|\/+$/g, "");
  return raw || "localhost:3000";
}

export function shopSubdomainHost(slug: string, base = shopSubdomainBase()): string {
  return `${slug}.${base}`;
}

/** Default time zone for a new shop by country (falls back to Europe/Amsterdam). */
const COUNTRY_TIMEZONES: Partial<Record<CountryCode, string>> = {
  NL: "Europe/Amsterdam", BE: "Europe/Brussels", LU: "Europe/Luxembourg", DE: "Europe/Berlin", FR: "Europe/Paris",
  GB: "Europe/London", AT: "Europe/Vienna", CH: "Europe/Zurich", DK: "Europe/Copenhagen", SE: "Europe/Stockholm",
  NO: "Europe/Oslo", FI: "Europe/Helsinki", IE: "Europe/Dublin", IT: "Europe/Rome", ES: "Europe/Madrid",
  PT: "Europe/Lisbon", PL: "Europe/Warsaw", CZ: "Europe/Prague",
};

export function defaultTimeZone(country: string): string {
  return (isCountryCode(country) && COUNTRY_TIMEZONES[country]) || "Europe/Amsterdam";
}

export function signupCountryOptions(): { value: string; label: string }[] {
  const first = SIGNUP_COUNTRIES.map((c) => ({ value: c, label: COUNTRIES[c] }));
  const rest = (Object.keys(COUNTRIES) as CountryCode[])
    .filter((c) => !SIGNUP_COUNTRIES.includes(c))
    .map((c) => ({ value: c, label: COUNTRIES[c] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...first, ...rest];
}

/** Lifetime of the owner invite sent on approval (AuthToken type INVITE). */
export const DEALER_INVITE_TTL_HOURS = 24;
