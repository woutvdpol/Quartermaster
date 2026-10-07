/*
 * Form description per settings group. Plain data (no server-only) so the client form renders it
 * and the server action parses FormData with the same list. `path` is the dot path inside the
 * group's settings object and doubles as the form field name and the Zod error key.
 */
import { DISPLAY_CURRENCIES, FONT_ALLOWLIST, type SettingsGroup } from "@/server/settings/schema";

type Base = { path: string; label: string; description?: string };
type Option = { value: string; label: string; description?: string };

export type SettingField =
  | (Base & { kind: "text" | "email" | "url"; maxLength?: number; nullable?: boolean; placeholder?: string; mono?: boolean })
  | (Base & { kind: "textarea"; maxLength?: number; rows?: number })
  | (Base & { kind: "switch" })
  | (Base & { kind: "select" | "segmented" | "radio"; options: Option[]; numeric?: boolean })
  | (Base & { kind: "number"; min?: number; max?: number; step?: number; integer?: boolean; nullable?: boolean; unit?: string; placeholder?: string })
  | (Base & { kind: "money" })
  | (Base & { kind: "color" })
  | (Base & { kind: "font" })
  | (Base & { kind: "country" })
  | (Base & { kind: "multicheck"; options: Option[] })
  | (Base & { kind: "tags"; maxTags?: number; placeholder?: string })
  | (Base & { kind: "storedPath" });

export type SettingSection = { title: string; description?: string; fields: SettingField[] };

export type GroupMeta = { label: string; description: string; sections: SettingSection[] };

export const FONT_OPTIONS: Option[] = FONT_ALLOWLIST.map((f) => ({ value: f, label: f }));

export const SETTINGS_FORMS: Record<SettingsGroup, GroupMeta> = {
  general: {
    label: "General",
    description: "Shop identity, contact details and display currencies.",
    sections: [
      {
        title: "Shop",
        fields: [
          { kind: "text", path: "shopName", label: "Shop name", maxLength: 120, description: "Shown in the shop header, mails and invoices." },
          { kind: "email", path: "contactEmail", label: "Contact e-mail", maxLength: 254, description: "Public contact address. Also the default reply-to for mails." },
          { kind: "text", path: "phone", label: "Phone", maxLength: 40 },
        ],
      },
      {
        title: "Address",
        description: "Used on invoices, packing slips and the contact page.",
        fields: [
          { kind: "text", path: "address.line1", label: "Address line 1", maxLength: 200 },
          { kind: "text", path: "address.line2", label: "Address line 2", maxLength: 200 },
          { kind: "text", path: "address.postalCode", label: "Postal code", maxLength: 20 },
          { kind: "text", path: "address.city", label: "City", maxLength: 100 },
          { kind: "country", path: "address.country", label: "Country" },
        ],
      },
      {
        title: "Display currencies",
        description: "Extra currencies visitors can see prices in. Checkout is always in the shop currency.",
        fields: [
          {
            kind: "multicheck",
            path: "displayCurrencies",
            label: "Show prices also in",
            options: DISPLAY_CURRENCIES.map((c) => ({ value: c, label: c })),
          },
        ],
      },
    ],
  },
  catalog: {
    label: "Catalog",
    description: "How the shop lists items, and which product features the admin uses.",
    sections: [
      {
        title: "Shop display",
        fields: [
          { kind: "segmented", path: "layout", label: "Catalog layout", description: "Default for new visitors.", options: [{ value: "grid", label: "Grid" }, { value: "list", label: "List" }] },
          { kind: "segmented", path: "gridColumns", label: "Grid columns", numeric: true, options: [{ value: "3", label: "3" }, { value: "4", label: "4" }] },
          {
            kind: "select",
            path: "defaultSort",
            label: "Default sort",
            options: [
              { value: "featured", label: "Featured first" },
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "updated", label: "Recently updated" },
              { value: "price_desc", label: "Price: high to low" },
              { value: "price_asc", label: "Price: low to high" },
            ],
          },
          { kind: "switch", path: "endlessScroll", label: "Endless scrolling", description: "Load more items while scrolling instead of pages." },
          { kind: "switch", path: "priceFilter", label: "Price filter", description: "Let visitors filter by price range." },
          { kind: "switch", path: "showTags", label: "Show tags", description: "Show product tags on the product page." },
          { kind: "switch", path: "showStockCode", label: "Show stock code", description: "Show the item's stock code in listings." },
          { kind: "switch", path: "showPriceWhenSold", label: "Show price when sold", description: "Show “Sold for €…” in the archive." },
          { kind: "switch", path: "publicArchive", label: "Public reference archive", description: "Sold items stay findable for collectors and search engines." },
          { kind: "switch", path: "relatedProducts", label: "Related products", description: "Show related items on the product page." },
          { kind: "switch", path: "allowOffersDefault", label: "Allow offers by default", description: "Can be overridden per product." },
        ],
      },
      {
        title: "Product admin",
        fields: [
          { kind: "switch", path: "skuEnabled", label: "SKU numbers", description: "Give every new product a sequential SKU." },
          { kind: "number", path: "skuStart", label: "First SKU number", integer: true, min: 0, max: 1_000_000_000 },
          { kind: "switch", path: "specifications", label: "Specifications", description: "Structured key/value specs on products." },
          { kind: "tags", path: "defaultSpecs", label: "Default specification fields", maxTags: 50, placeholder: "e.g. Maker, Period, Size", description: "Prefilled on new products. Press Enter after each one." },
          { kind: "switch", path: "featuredRanking", label: "Featured ranking", description: "Rank products to control the “Featured” sort." },
          { kind: "switch", path: "stolenStatus", label: "Stolen-item status", description: "Mark items reported stolen." },
          { kind: "switch", path: "purchaseRecords", label: "Purchase records", description: "Track purchase price and provenance (needed for margins)." },
        ],
      },
    ],
  },
  checkout: {
    label: "Checkout",
    description: "Cart reservation, minimums and free shipping.",
    sections: [
      {
        title: "Cart & checkout",
        fields: [
          { kind: "number", path: "reservationMinutes", label: "Cart reservation", integer: true, min: 5, max: 60, unit: "min", description: "How long a unique item stays reserved for a customer who has it in their cart (5–60)." },
          { kind: "switch", path: "guestCheckout", label: "Guest checkout", description: "Customers can order without an account." },
          { kind: "switch", path: "directCheckout", label: "Direct checkout", description: "“Buy now” skips the cart." },
          { kind: "text", path: "termsPageSlug", label: "Terms page", nullable: true, mono: true, placeholder: "terms", maxLength: 100, description: "Slug of the CMS page customers must accept. Leave empty for none." },
          { kind: "switch", path: "packingSlipPrices", label: "Prices on packing slip", description: "Print item prices on packing slips." },
        ],
      },
      {
        title: "Amounts",
        description: "In the shop currency. 0 turns the rule off.",
        fields: [
          { kind: "money", path: "minimumOrderCents", label: "Minimum order value" },
          { kind: "money", path: "freeShippingThresholdCents", label: "Free shipping from", description: "Delivery is free from this subtotal. Pickup prices are not affected." },
        ],
      },
    ],
  },
  appearance: {
    label: "Appearance",
    description: "Shop colours, fonts and images.",
    sections: [
      {
        title: "Colours",
        description: "Become the shop's theme tokens.",
        fields: [
          { kind: "color", path: "colors.primary", label: "Primary colour" },
          { kind: "color", path: "colors.secondary", label: "Secondary colour" },
          { kind: "color", path: "colors.accent", label: "Accent colour" },
        ],
      },
      {
        title: "Fonts",
        fields: [
          { kind: "font", path: "headingFont", label: "Heading font" },
          { kind: "font", path: "textFont", label: "Text font" },
        ],
      },
      {
        title: "Images",
        description: "Uploaded files. Changing them is not available on this screen yet.",
        fields: [
          { kind: "storedPath", path: "logoPath", label: "Logo" },
          { kind: "storedPath", path: "bannerPath", label: "Banner" },
          { kind: "storedPath", path: "ctaImagePath", label: "Call-to-action image" },
        ],
      },
    ],
  },
  content: {
    label: "Content",
    description: "Home page, banner and contact options.",
    sections: [
      {
        title: "Pages",
        fields: [
          { kind: "switch", path: "homeRedirectsToShop", label: "Home opens the shop", description: "Visitors to the home page go straight to the catalog." },
          { kind: "switch", path: "bannerOnHome", label: "Banner on home page" },
          { kind: "switch", path: "bannerOnPages", label: "Banner on other pages" },
          { kind: "switch", path: "contactForm", label: "Contact form", description: "Show a contact form on the contact page." },
          { kind: "switch", path: "newsletterPopup", label: "Newsletter pop-up", description: "Invite first-time visitors to sign up." },
        ],
      },
    ],
  },
  legal: {
    label: "Legal & age",
    description: "Age verification, sensitive items and disclaimers.",
    sections: [
      {
        title: "Age verification",
        fields: [
          {
            kind: "radio",
            path: "ageVerification",
            label: "Ask visitors to confirm their age",
            options: [
              { value: "off", label: "Off" },
              { value: "popup", label: "On first visit", description: "A pop-up asks visitors to confirm their age." },
              { value: "checkout", label: "At checkout", description: "Confirmed at checkout and stored on the order." },
            ],
          },
          { kind: "number", path: "minimumAge", label: "Minimum age", integer: true, min: 16, max: 21, unit: "years" },
          { kind: "switch", path: "blurSensitiveForGuests", label: "Blur sensitive items for guests", description: "Visitors must sign in to see items marked sensitive." },
        ],
      },
      {
        title: "Disclaimers",
        fields: [
          { kind: "textarea", path: "disclaimers.footer", label: "Footer disclaimer", maxLength: 2000, rows: 3 },
          { kind: "textarea", path: "disclaimers.product", label: "Product page disclaimer", maxLength: 2000, rows: 3 },
          { kind: "textarea", path: "disclaimers.checkout", label: "Checkout disclaimer", maxLength: 2000, rows: 3 },
        ],
      },
    ],
  },
  mail: {
    label: "Mail",
    description: "Sender details and order notifications.",
    sections: [
      {
        title: "Sender",
        description: "Empty fields fall back to the shop name and contact e-mail.",
        fields: [
          { kind: "text", path: "fromName", label: "From name", maxLength: 120 },
          { kind: "email", path: "replyTo", label: "Reply-to address", maxLength: 254 },
          { kind: "email", path: "orderNotificationEmail", label: "New-order notifications to", maxLength: 254 },
        ],
      },
      {
        title: "Order confirmation",
        fields: [{ kind: "textarea", path: "confirmationMessage", label: "Extra text in the confirmation mail", maxLength: 5000, rows: 5 }],
      },
    ],
  },
  analytics: {
    label: "Analytics",
    description: "Visitor statistics.",
    sections: [
      {
        title: "Provider",
        fields: [
          {
            kind: "radio",
            path: "provider",
            label: "Statistics",
            options: [
              { value: "own", label: "Built-in", description: "Privacy-friendly statistics stored in Quartermaster." },
              { value: "matomo", label: "Matomo", description: "Send page views to your own Matomo server." },
              { value: "none", label: "Off" },
            ],
          },
          { kind: "url", path: "matomoUrl", label: "Matomo URL", nullable: true, mono: true, placeholder: "https://stats.example.com", description: "Required for Matomo. Must use https." },
          { kind: "number", path: "matomoSiteId", label: "Matomo site ID", integer: true, min: 1, nullable: true, description: "Required for Matomo." },
        ],
      },
    ],
  },
  platform: {
    label: "Platform",
    description: "Plan and limits for this shop. Only Quartermaster admins can see and change these.",
    sections: [
      {
        title: "Plan & limits",
        fields: [
          { kind: "segmented", path: "plan", label: "Plan", options: [{ value: "bronze", label: "Bronze" }, { value: "silver", label: "Silver" }, { value: "gold", label: "Gold" }] },
          { kind: "number", path: "productLimit", label: "Product limit", integer: true, min: 0, nullable: true, placeholder: "Plan default", description: "Leave empty for the plan default." },
          { kind: "number", path: "photoLimit", label: "Photos per product", integer: true, min: 1, max: 100, nullable: true, placeholder: "Plan default", description: "Leave empty for the plan default." },
          { kind: "number", path: "storageQuotaGb", label: "Storage quota", min: 0, max: 10_000, step: 0.5, unit: "GB" },
        ],
      },
      {
        title: "Newsletter",
        fields: [
          { kind: "switch", path: "newsletterEnabled", label: "Newsletter module" },
          { kind: "number", path: "newsletterQuota", label: "Mails per month", integer: true, min: -1, description: "-1 = unlimited." },
        ],
      },
    ],
  },
};

/** Order in the sub-navigation (platform last, SUPERADMIN only). */
export const SHOP_GROUPS: SettingsGroup[] = ["general", "catalog", "checkout", "appearance", "content", "legal", "mail", "analytics"];

export function groupFields(group: SettingsGroup): SettingField[] {
  return SETTINGS_FORMS[group].sections.flatMap((s) => s.fields);
}

/** Reads a dot path from a settings object. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
