// Typed tenant settings. One `Setting` row per (tenantId, group); `data` holds the group's JSON.
// Every field has a default, so an empty or missing row parses to a complete, valid object.
//
// This file is pure (no `server-only`, no DB) so it can be used by the seed, the ETL and tests.
//
// Zod v4 note: nested objects use `.prefault({})` rather than `.default({})`. `.default()` returns the
// default value as-is (skipping inner defaults); `.prefault()` parses it, so inner defaults apply.
import { z } from "zod";

// ─── Shared primitives ──────────────────────────────────────────────────────

export const DISPLAY_CURRENCIES = ["EUR", "USD", "GBP", "AUD", "JPY", "CAD", "CNY", "NZD"] as const;

/** Google Fonts we self-host / allow. Free-form font names (legacy `select_font`) are not accepted. */
export const FONT_ALLOWLIST = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Oswald",
  "Bebas Neue",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "Merriweather",
  "Playfair Display",
  "Libre Baskerville",
  "EB Garamond",
  "Cormorant Garamond",
  "Source Serif 4",
  "Special Elite",
  // Added with the storefront redesign (theme "gallery" + the planned theme-builder presets).
  "Hanken Grotesk",
  "Instrument Serif",
  "Newsreader",
  "Archivo",
  "Work Sans",
  "Libre Caslon Display",
  // Theme "fieldkit" display face (next/font has no fallback metrics for it: adjustFontFallback off).
  "Big Shoulders",
] as const;

/**
 * Storefront theme presets. A preset sets the layout character (neutrals, header treatment, heading
 * style, accent and mono fonts) on top of the tenant's colours and fonts — see
 * `.shop-root[data-shop-theme]` in src/app/(shop)/shop.css and the builder defaults in
 * src/server/theme/presets.ts. Designs: docs/design/shop-options.
 */
export const SHOP_THEMES = ["gallery", "archive", "fieldkit", "vault"] as const;
/** Corner radius of cards/images (sharp 0 · soft 6px · round 14px). */
export const SHOP_CORNERS = ["sharp", "soft", "round"] as const;
/** Shape of buttons, inputs and chips (square 0 · rounded 8px · pill). */
export const SHOP_BUTTON_SHAPES = ["square", "rounded", "pill"] as const;
/** Spacing scale for sections and grids (compact 0.75 · comfortable 1 · spacious 1.3). */
export const SHOP_DENSITIES = ["compact", "comfortable", "spacious"] as const;

export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex color like #1a2b3c")
  .transform((s) => s.toLowerCase());

const font = z.enum(FONT_ALLOWLIST);

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A path to a stored file, e.g. "/uploads/<tenant>/branding/logo.webp". No schemes, no traversal. */
const storedPath = z
  .string()
  .trim()
  .max(500)
  .regex(/^\/[A-Za-z0-9._\-/]+$/, "Expected an absolute storage path")
  .refine((p) => !p.split("/").includes(".."), "Path traversal is not allowed")
  .nullable();

/** Optional e-mail: empty string means "not set". */
const optionalEmail = z.union([z.literal(""), z.email().max(254)]);

const shortText = (max = 200) => z.string().trim().max(max);

/** Removes spaces/dots/dashes and upper-cases (VAT ids and IBANs are typed in many ways). */
const compactUpper = (s: string) => s.replace(/[\s.\-]/g, "").toUpperCase();

/** Chamber of Commerce (KvK) number; loose so foreign registrations fit. "" = not set. */
const cocNumber = shortText(30).regex(/^[A-Za-z0-9 .\-/]*$/, "Use letters, digits, spaces or dashes only");

/** EU-style VAT id, e.g. NL123456789B01 (country code + 2–13 characters). "" = not set. */
const vatNumber = z
  .string()
  .max(40)
  .transform(compactUpper)
  .pipe(z.string().regex(/^([A-Z]{2}[0-9A-Z+*]{2,13})?$/, "Expected a VAT id like NL123456789B01"));

/** IBAN, basic format check only (country code, 2 check digits, 10–30 characters). "" = not set. */
const iban = z
  .string()
  .max(50)
  .transform(compactUpper)
  .pipe(z.string().regex(/^([A-Z]{2}[0-9]{2}[A-Z0-9]{10,30})?$/, "Expected an IBAN like NL91ABNA0417164300"));

// ─── Groups ─────────────────────────────────────────────────────────────────

export const generalSchema = z.object({
  shopName: shortText(120).default(""),
  contactEmail: optionalEmail.default(""),
  phone: shortText(40).default(""),
  address: z
    .object({
      line1: shortText().default(""),
      line2: shortText().default(""),
      postalCode: shortText(20).default(""),
      city: shortText(100).default(""),
      country: z
        .string()
        .regex(/^([A-Z]{2})?$/, "ISO 3166-1 alpha-2 code")
        .default("NL"),
    })
    .prefault({}),
  // Business details (invoices). "" = not set; normalised (VAT id / IBAN upper-case without spaces).
  cocNumber: cocNumber.default(""),
  vatNumber: vatNumber.default(""),
  iban: iban.default(""),
  // Time zone lives on Tenant.timezone (single source of truth); validate writes with isValidTimeZone.
  // Extra currencies prices may be *displayed* in. Checkout is always in the shop currency (decision 17).
  displayCurrencies: z.array(z.enum(DISPLAY_CURRENCIES)).max(DISPLAY_CURRENCIES.length).default([]),
});

export const catalogSchema = z.object({
  layout: z.enum(["grid", "list"]).default("grid"),
  gridColumns: z.union([z.literal(3), z.literal(4)]).default(4),
  defaultSort: z.enum(["featured", "price_desc", "price_asc", "newest", "oldest", "updated"]).default("newest"),
  endlessScroll: z.boolean().default(false),
  showPriceWhenSold: z.boolean().default(false),
  priceFilter: z.boolean().default(false),
  showTags: z.boolean().default(true),
  showStockCode: z.boolean().default(true),
  publicArchive: z.boolean().default(false),
  relatedProducts: z.boolean().default(false),
  allowOffersDefault: z.boolean().default(false),
  // Product-admin features
  skuEnabled: z.boolean().default(false),
  skuStart: z.int().min(0).max(1_000_000_000).default(1),
  specifications: z.boolean().default(false),
  defaultSpecs: z.array(shortText(80).min(1)).max(50).default([]),
  featuredRanking: z.boolean().default(false),
  stolenStatus: z.boolean().default(false),
  purchaseRecords: z.boolean().default(false),
});

export const checkoutSchema = z.object({
  // Decision 18: 15 minutes. Legacy allowed 10 s … 1 h; seconds made no sense for a checkout.
  reservationMinutes: z.int().min(5).max(60).default(15),
  guestCheckout: z.boolean().default(true),
  directCheckout: z.boolean().default(false),
  termsPageSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a page slug")
    .max(100)
    .nullable()
    .default("terms"),
  // In minor units of the shop currency; 0 = no minimum.
  minimumOrderCents: z.int().min(0).max(100_000_00).default(0),
  // Free shipping from this subtotal (minor units); 0 = off. Pickup prices are unaffected.
  freeShippingThresholdCents: z.int().min(0).max(100_000_00).default(0),
  packingSlipPrices: z.boolean().default(true),
});

export const appearanceSchema = z.object({
  colors: z
    .object({
      primary: hexColor.default("#1f4d3a"),
      secondary: hexColor.default("#d9d6ce"),
      accent: hexColor.default("#7a2420"),
    })
    .prefault({}),
  theme: z.enum(SHOP_THEMES).default("gallery"),
  headingFont: font.default("Hanken Grotesk"),
  textFont: font.default("Hanken Grotesk"),
  // Theme-builder tunables (defaults = the Gallery look). Edited only via Website → Theme.
  corners: z.enum(SHOP_CORNERS).default("soft"),
  buttonShape: z.enum(SHOP_BUTTON_SHAPES).default("pill"),
  density: z.enum(SHOP_DENSITIES).default("comfortable"),
  logoPath: storedPath.default(null),
  bannerPath: storedPath.default(null),
  ctaImagePath: storedPath.default(null),
});

/** Public profile URL (social media, marketplace shop, association page) — https only. */
const profileUrl = z.url({ protocol: /^https$/ }).max(300);

export const contentSchema = z.object({
  homeRedirectsToShop: z.boolean().default(false),
  bannerOnHome: z.boolean().default(true),
  bannerOnPages: z.boolean().default(false),
  contactForm: z.boolean().default(true),
  newsletterPopup: z.boolean().default(false),
  // Search engines & AI assistants (docs/seo-geo.md).
  seo: z
    .object({
      // Default meta description of the shop (home page, Organization, llms.txt). "" = generated.
      description: shortText(300).default(""),
      // false: robots.txt blocks AI *training* crawlers (GPTBot, ClaudeBot, Google-Extended …);
      // AI *search* crawlers that cite the shop in answers stay allowed either way.
      allowAiTraining: z.boolean().default(true),
      // Official profiles of the shop elsewhere (schema.org sameAs: entity consistency).
      sameAs: z.array(profileUrl).max(10).default([]),
    })
    .prefault({}),
});

export const legalSchema = z.object({
  // "off": nothing; "popup": confirm age on first visit (legacy `age_verify`);
  // "checkout": confirm age at checkout and store it on the order.
  ageVerification: z.enum(["off", "popup", "checkout"]).default("off"),
  minimumAge: z.int().min(16).max(21).default(18),
  // Decision 19: products flagged sensitive are blurred for guests (login to view).
  blurSensitiveForGuests: z.boolean().default(true),
  // Published return policy (structured data on products + Organization, markdown/llms.txt summaries).
  // EU consumers have a 14-day right of withdrawal on distance sales; 0 = returns not accepted.
  returns: z
    .object({
      days: z.int().min(0).max(365).default(14),
      fees: z.enum(["customer", "free"]).default("customer"),
    })
    .prefault({}),
  disclaimers: z
    .object({
      footer: shortText(2000).default(""),
      product: shortText(2000).default(""),
      checkout: shortText(2000).default(""),
    })
    .prefault({}),
});

export const mailSchema = z.object({
  fromName: shortText(120).default(""), // "" = use general.shopName
  replyTo: optionalEmail.default(""), // "" = use general.contactEmail
  orderNotificationEmail: optionalEmail.default(""), // "" = use general.contactEmail
  confirmationMessage: shortText(5000).default(""),
});

export const analyticsSchema = z
  .object({
    provider: z.enum(["none", "own", "matomo"]).default("own"),
    matomoUrl: z.url({ protocol: /^https$/ }).nullable().default(null),
    matomoSiteId: z.int().min(1).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.provider !== "matomo") return;
    if (!v.matomoUrl) ctx.addIssue({ code: "custom", path: ["matomoUrl"], message: "Required for Matomo" });
    if (!v.matomoSiteId) ctx.addIssue({ code: "custom", path: ["matomoSiteId"], message: "Required for Matomo" });
  });

/** SUPERADMIN-only. Limits use `null` for "plan default". */
export const platformSchema = z.object({
  plan: z.enum(["bronze", "silver", "gold"]).default("bronze"),
  productLimit: z.int().min(0).nullable().default(null),
  photoLimit: z.int().min(1).max(100).nullable().default(null),
  newsletterEnabled: z.boolean().default(false),
  // Mails per month; -1 = unlimited. Usage is counted elsewhere, not by decrementing this value.
  newsletterQuota: z.int().min(-1).default(1000),
  storageQuotaGb: z.number().min(0).max(10_000).default(5),
});

// ─── Registry ───────────────────────────────────────────────────────────────

export const SETTINGS_SCHEMAS = {
  general: generalSchema,
  catalog: catalogSchema,
  checkout: checkoutSchema,
  appearance: appearanceSchema,
  content: contentSchema,
  legal: legalSchema,
  mail: mailSchema,
  analytics: analyticsSchema,
  platform: platformSchema,
} as const;

export type SettingsGroup = keyof typeof SETTINGS_SCHEMAS;
export const SETTINGS_GROUPS = Object.keys(SETTINGS_SCHEMAS) as SettingsGroup[];
/** Groups only a SUPERADMIN may change. */
export const PLATFORM_ONLY_GROUPS: ReadonlySet<SettingsGroup> = new Set(["platform"]);

export type Settings<G extends SettingsGroup> = z.output<(typeof SETTINGS_SCHEMAS)[G]>;
export type SettingsInput<G extends SettingsGroup> = z.input<(typeof SETTINGS_SCHEMAS)[G]>;

/** Deep-partial patch: nested objects merge, arrays and scalars replace. */
export type SettingsPatch<G extends SettingsGroup> = DeepPartial<Settings<G>>;
type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export function isSettingsGroup(value: string): value is SettingsGroup {
  return Object.hasOwn(SETTINGS_SCHEMAS, value);
}

export function defaultSettings<G extends SettingsGroup>(group: G): Settings<G> {
  return SETTINGS_SCHEMAS[group].parse({}) as Settings<G>;
}

/**
 * Parse stored data leniently: a stored value that no longer validates (e.g. after a schema change)
 * falls back to its default instead of breaking the shop. Use `SETTINGS_SCHEMAS[g].parse` for strict input.
 */
export function parseStoredSettings<G extends SettingsGroup>(
  group: G,
  data: unknown,
): { value: Settings<G>; invalidKeys: string[] } {
  const schema = SETTINGS_SCHEMAS[group];
  const input = isPlainObject(data) ? { ...data } : {};
  const invalidKeys: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = schema.safeParse(input);
    if (result.success) return { value: result.data as Settings<G>, invalidKeys };
    let removed = false;
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && key in input) {
        delete input[key];
        invalidKeys.push(key);
        removed = true;
      }
    }
    // Cross-field failures (no removable key) — give up and use defaults.
    if (!removed) break;
  }
  return { value: defaultSettings(group), invalidKeys: [...new Set([...invalidKeys, "*"])] };
}

/** Merge a patch into current settings: plain objects merge recursively, everything else replaces. */
export function mergeSettings(current: unknown, patch: unknown): unknown {
  if (!isPlainObject(current) || !isPlainObject(patch)) return patch === undefined ? current : patch;
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = mergeSettings(current[k], v);
  }
  return out;
}

/** Dot-paths of leaf values that differ between two parsed settings objects. */
export function changedKeys(before: unknown, after: unknown, prefix = ""): string[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((k) => changedKeys(before[k], after[k], prefix ? `${prefix}.${k}` : k));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix || "*"];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─── Legacy (Concept500 `settings` table) → new location, for the ETL ───────
//
// Target notation: "<group>.<path>" for settings, "Tenant.<column>" for tenant columns.
// `transform` describes the value conversion the ETL must apply.

export type LegacyMapping = { to: string; transform?: string };

export const LEGACY_KEY_MAP: Record<string, LegacyMapping> = {
  // General / identity
  shop_name: { to: "general.shopName" },
  email: { to: "general.contactEmail" },
  currency: { to: "Tenant.currency", transform: "base currency; general.displayCurrencies starts empty" },
  timezone: { to: "Tenant.timezone", transform: "legacy default UTC" },
  matomo_id: { to: "analytics.matomoSiteId", transform: "int; set analytics.provider='matomo' when present" },
  confirmation_message: { to: "mail.confirmationMessage", transform: "legacy value looked unused; import if non-empty" },

  // Subscription & limits (SUPERADMIN)
  subscription_type: { to: "platform.plan" },
  maximum_items: { to: "platform.productLimit", transform: "empty → null" },
  maximum_item_photos: { to: "platform.photoLimit", transform: "empty → null" },
  emailer: { to: "platform.newsletterEnabled" },
  emailer_quota: { to: "platform.newsletterQuota", transform: "legacy was a decrementing credit counter (OWNER-editable!)" },

  // Content & navigation
  home_shop: { to: "content.homeRedirectsToShop" },
  toggle_banner_homepage: { to: "content.bannerOnHome" },
  toggle_banner_pages: { to: "content.bannerOnPages" },
  toggle_contact_form: { to: "content.contactForm" },
  show_emailer_popup: { to: "content.newsletterPopup" },

  // Shop display
  list_or_grid_view: { to: "catalog.layout", transform: "'grid-view' → 'grid', 'list-view' → 'list'" },
  shop_display_amount: { to: "catalog.gridColumns", transform: "'3'|'4' → number" },
  shop_selected_filter: {
    to: "catalog.defaultSort",
    transform: "highlow→price_desc, lowhigh→price_asc, lastupdated→updated, others same",
  },
  endless_scrolling: { to: "catalog.endlessScroll" },
  show_price_when_sold: { to: "catalog.showPriceWhenSold" },
  toggle_price_range: { to: "catalog.priceFilter" },
  show_tags: { to: "catalog.showTags" },
  toggle_listview_stock_code: { to: "catalog.showStockCode", transform: "merged: use the key of the active layout; read string_value too (seed bug)" },
  toggle_gridview_stock_code: { to: "catalog.showStockCode", transform: "see toggle_listview_stock_code" },
  direct_checkout: { to: "checkout.directCheckout" },
  age_verify: { to: "legal.ageVerification", transform: "true → 'popup', false → 'off'" },

  // Product management
  sku: { to: "catalog.skuEnabled" },
  default_sku: { to: "catalog.skuStart" },
  product_blur: { to: "legal.blurSensitiveForGuests" },
  product_specifications: { to: "catalog.specifications" },
  default_specs: { to: "catalog.defaultSpecs", transform: "list json → string[]" },
  related_products: { to: "catalog.relatedProducts" },
  purchase_information: { to: "catalog.purchaseRecords" },
  show_purchase_price: { to: "catalog.purchaseRecords", transform: "merged: purchase price is part of purchase records (OR both)" },
  toggle_product_importance: { to: "catalog.featuredRanking" },
  toggle_stolen_status: { to: "catalog.stolenStatus" },
  toggle_archive_page: { to: "catalog.publicArchive" },
  reserved_time: { to: "checkout.reservationMinutes", transform: "seconds → minutes, clamp to 5..60 (decision 18: 15)" },

  // Orders
  toggle_packing_slip_prices: { to: "checkout.packingSlipPrices" },

  // Theming
  logo: { to: "appearance.logoPath", transform: "download Cloudflare image → local storage path" },
  banner_image: { to: "appearance.bannerPath", transform: "download Cloudflare image → local storage path" },
  cta_image: { to: "appearance.ctaImagePath", transform: "download Cloudflare image → local storage path" },
  primary_color: { to: "appearance.colors.primary", transform: "normalize to #rrggbb" },
  secondary_color: { to: "appearance.colors.secondary", transform: "normalize to #rrggbb" },
  tertiary_color: { to: "appearance.colors.accent", transform: "normalize to #rrggbb" },
  heading_font: { to: "appearance.headingFont", transform: "fallback to default if not in FONT_ALLOWLIST" },
  text_font: { to: "appearance.textFont", transform: "fallback to default if not in FONT_ALLOWLIST" },
};

/** Legacy keys intentionally not carried over, with the reason. */
export const DROPPED_LEGACY_KEYS: Record<string, string> = {
  product_import: "Product import is out of scope (decision 13).",
  share_on_socials: "Dead in legacy (layout read `settings.socials-share`).",
  toggle_bump_to_top: "Ignored by legacy code; 'bump' becomes a plain product action if wanted.",
  toggle_order_archive_page: "Orders are never deleted, only archived (decision 10); the archive view is always available.",
  terms: "Page visibility moves to the CMS page's own published flag.",
  privacy: "Page visibility moves to the CMS page's own published flag.",
  contact: "Page visibility moves to the CMS page's own published flag.",
  links: "Page visibility moves to the CMS page's own published flag.",
  about: "Page visibility moves to the CMS page's own published flag.",
  events: "Page visibility moves to the CMS page's own published flag.",
  news: "Page visibility moves to the CMS page's own published flag.",
  banner: "Banner visibility is covered by content.bannerOnHome / bannerOnPages and appearance.bannerPath.",
};
