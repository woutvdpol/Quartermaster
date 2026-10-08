// Pure rules for the owner setup wizard (no DB): steps, the persisted progress in Tenant.setupState,
// shipping zone templates and legal page templates.
import { BENELUX_COUNTRIES, EU_COUNTRIES, countryName, type CountryCode } from "@/server/shipping/countries";

// ─── Steps + progress ───────────────────────────────────────────────────────

export const SETUP_STEPS = [
  { key: "basics", label: "Shop basics", hint: "Name, subdomain, language", skippable: false },
  { key: "business", label: "Business details", hint: "CoC, VAT, IBAN, address", skippable: false },
  { key: "look", label: "Look & feel", hint: "Theme builder", skippable: true },
  { key: "payments", label: "Payments", hint: "Connect Mollie (test first)", skippable: true },
  { key: "shipping", label: "Shipping", hint: "Zones from a template", skippable: true },
  { key: "import", label: "Import products", hint: "WooCommerce · Shopify · Concept500", skippable: true },
  { key: "legal", label: "Legal pages", hint: "Terms, privacy, returns templates", skippable: true },
  { key: "golive", label: "Go live", hint: "Checklist + own domain", skippable: false },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];
export const SETUP_STEP_KEYS = SETUP_STEPS.map((s) => s.key) as SetupStepKey[];

export function isSetupStepKey(value: unknown): value is SetupStepKey {
  return typeof value === "string" && (SETUP_STEP_KEYS as string[]).includes(value);
}

export type StepProgress = {
  done: boolean;
  skipped?: boolean;
  at: string;
  /** Import step: the chosen source. */
  choice?: string;
  /** Go-live step: the own domain the owner asked for. */
  domainRequest?: string;
};
export type SetupState = Partial<Record<SetupStepKey, StepProgress>>;

/** Lenient parse of Tenant.setupState (unknown keys / malformed entries are dropped). */
export function parseSetupState(value: unknown): SetupState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SetupState = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isSetupStepKey(key) || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    out[key] = {
      done: r.done === true,
      ...(r.skipped === true ? { skipped: true } : {}),
      at: typeof r.at === "string" ? r.at : "",
      ...(typeof r.choice === "string" ? { choice: r.choice } : {}),
      ...(typeof r.domainRequest === "string" ? { domainRequest: r.domainRequest } : {}),
    };
  }
  return out;
}

/** Wizard pending: the tenant was created by onboarding (setupState not null) and has not gone live. */
export function isSetupPending(tenant: { setupState: unknown; setupCompletedAt: Date | null }): boolean {
  return tenant.setupState !== null && tenant.setupState !== undefined && tenant.setupCompletedAt === null;
}

export type StepStatus = "done" | "skipped" | "todo";

export function stepStatus(state: SetupState, key: SetupStepKey): StepStatus {
  const s = state[key];
  if (!s) return "todo";
  if (s.skipped) return "skipped";
  return s.done ? "done" : "todo";
}

/** The step to open by default: the first that is neither done nor skipped (else Go live). */
export function firstOpenStep(state: SetupState): SetupStepKey {
  return SETUP_STEP_KEYS.find((k) => stepStatus(state, k) === "todo") ?? "golive";
}

export function stepIndex(key: SetupStepKey): number {
  return SETUP_STEP_KEYS.indexOf(key);
}

export function nextStep(key: SetupStepKey): SetupStepKey | null {
  return SETUP_STEP_KEYS[stepIndex(key) + 1] ?? null;
}

export function previousStep(key: SetupStepKey): SetupStepKey | null {
  return SETUP_STEP_KEYS[stepIndex(key) - 1] ?? null;
}

export function completedStepCount(state: SetupState): number {
  return SETUP_STEP_KEYS.filter((k) => stepStatus(state, k) !== "todo").length;
}

/** Merges one step's progress into the stored state (pure; the service persists it under a row lock). */
export function withStep(state: SetupState, key: SetupStepKey, progress: Omit<StepProgress, "at">, now = new Date()): SetupState {
  return { ...state, [key]: { ...state[key], ...progress, at: now.toISOString() } };
}

// ─── Import choices ─────────────────────────────────────────────────────────

export const IMPORT_CHOICES = ["woocommerce", "shopify", "concept500", "empty"] as const;
export type ImportChoice = (typeof IMPORT_CHOICES)[number];

// ─── Shipping templates ─────────────────────────────────────────────────────

export const SHIPPING_TEMPLATES = ["domestic", "eu", "worldwide"] as const;
export type ShippingTemplate = (typeof SHIPPING_TEMPLATES)[number];

export type TemplateZone = {
  name: string;
  countries: string[];
  rates: { maxWeightGrams: number; price: number }[];
};

/** Starter weight tiers (minor units): ≤ 2 kg, ≤ 10 kg, ≤ 30 kg. Owners edit them on the Shipping page. */
const TIERS = {
  domestic: [695, 895, 1495],
  near: [995, 1495, 2295],
  eu: [1495, 2495, 3995],
  world: [2995, 5995, 9995],
} as const;

function tiers(prices: readonly number[]) {
  return [2000, 10_000, 30_000].map((maxWeightGrams, i) => ({ maxWeightGrams, price: prices[i] }));
}

export function shippingTemplateLabel(template: ShippingTemplate, home: string): string {
  const isBenelux = (BENELUX_COUNTRIES as readonly string[]).includes(home);
  if (template === "domestic") return `${countryName(home)} only`;
  if (template === "eu") return `${isBenelux ? "Benelux" : countryName(home)} + EU`;
  return "Worldwide";
}

/**
 * Zones a template creates for a shop based in `home`. Domestic = home country; EU adds the other
 * Benelux countries (when home is in the Benelux) and the rest of the EU; Worldwide adds "rest of world".
 */
export function shippingTemplateZones(template: ShippingTemplate, home: string): TemplateZone[] {
  const zones: TemplateZone[] = [{ name: countryName(home), countries: [home], rates: tiers(TIERS.domestic) }];
  if (template === "domestic") return zones;
  const covered = new Set<string>([home]);
  if ((BENELUX_COUNTRIES as readonly string[]).includes(home)) {
    const others = BENELUX_COUNTRIES.filter((c) => c !== home);
    zones.push({ name: others.map((c) => countryName(c)).join(" & "), countries: [...others], rates: tiers(TIERS.near) });
    others.forEach((c) => covered.add(c));
  }
  const eu = EU_COUNTRIES.filter((c: CountryCode) => !covered.has(c));
  if (eu.length) zones.push({ name: "European Union", countries: [...eu], rates: tiers(TIERS.eu) });
  if (template === "worldwide") zones.push({ name: "Rest of world", countries: ["*"], rates: tiers(TIERS.world) });
  return zones;
}

// ─── Legal page templates ───────────────────────────────────────────────────

export const LEGAL_PAGES = ["terms", "privacy", "returns", "shipping"] as const;
export type LegalPageKey = (typeof LEGAL_PAGES)[number];

export const LEGAL_PAGE_INFO: Record<LegalPageKey, { title: string; slug: string; systemKey: "TERMS" | "PRIVACY" | null }> = {
  terms: { title: "Terms and conditions", slug: "terms", systemKey: "TERMS" },
  privacy: { title: "Privacy policy", slug: "privacy", systemKey: "PRIVACY" },
  returns: { title: "Returns and withdrawal", slug: "returns", systemKey: null },
  shipping: { title: "Shipping and delivery", slug: "shipping", systemKey: null },
};

export type LegalVars = {
  shopName: string;
  email: string;
  address: string;
  cocNumber: string;
  vatNumber: string;
  country: string;
};

const or = (v: string, fallback: string) => (v.trim() ? v.trim() : fallback);

/**
 * English starter text for a legal page, filled with the shop's details. These are templates: the
 * wizard tells the owner to have them checked; they are not legal advice.
 */
export function legalTemplateMarkdown(key: LegalPageKey, v: LegalVars): string {
  const shop = or(v.shopName, "this shop");
  const email = or(v.email, "[your email address]");
  const address = or(v.address, "[your business address]");
  const company = [
    `**${shop}**`,
    address,
    v.cocNumber.trim() ? `Chamber of Commerce: ${v.cocNumber.trim()}` : "",
    v.vatNumber.trim() ? `VAT: ${v.vatNumber.trim()}` : "",
    `Email: ${email}`,
  ]
    .filter(Boolean)
    .join("\n");

  switch (key) {
    case "terms":
      return [
        "## 1. Who we are",
        company,
        "## 2. Scope",
        `These terms apply to every offer by and every order placed with ${shop}.`,
        "## 3. Items",
        "Most items we sell are unique, original pieces. Every item is described and photographed as accurately as we can. Small signs of age and use are normal for historical items and are not a defect. Deactivated weapons are sold only with a valid deactivation certificate and only to countries where this is allowed.",
        "## 4. Prices and payment",
        "Prices are shown in the shop currency and include VAT where applicable. Shipping costs are shown at checkout. An item is reserved for you while you check out and is sold once payment has been received.",
        "## 5. Delivery",
        "We ship after payment has been received, well packed and, where possible, with track & trace. See our shipping page for costs and delivery times.",
        "## 6. Right of withdrawal",
        "As a consumer in the EU you may withdraw from a purchase within 14 days after receiving the item, without giving a reason. See our returns page for how this works.",
        "## 7. Authenticity",
        "We guarantee that every item is as described. If an item turns out not to be authentic or not as described, you can return it for a full refund.",
        "## 8. Legal compliance",
        "You are responsible for complying with the laws of your country regarding the import and possession of the items you buy. We may refuse orders to countries where an item may not be imported.",
        "## 9. Complaints and applicable law",
        `Questions or complaints? Contact us at ${email}. These terms are governed by the law of the country where ${shop} is established, without prejudice to mandatory consumer protection rules of your country.`,
      ].join("\n\n");
    case "privacy":
      return [
        "## Who is responsible",
        company,
        "## What we collect",
        "When you order or create an account we process your name, address, email address, phone number (optional), your orders and payment status. Payments are handled by our payment provider; we never see your card or bank details.",
        "## Why",
        "We use these details to process and deliver your order, to send order and shipping updates, to keep the records the law requires (for example invoices), and — only if you subscribe — to send our newsletter or item alerts.",
        "## How long",
        "Order and invoice data is kept as long as tax law requires (usually 7 years). Account data is kept until you delete your account. Newsletter subscriptions end when you unsubscribe.",
        "## Who receives your data",
        "Only the parties needed to run the shop: our hosting and email providers, our payment provider and the carrier that delivers your parcel. We do not sell your data.",
        "## Cookies and statistics",
        "We use functional cookies (for example your shopping cart and sign-in). Visitor statistics are collected without tracking cookies.",
        "## Your rights",
        `You can ask to see, correct, export or delete your data, and object to its use. Email ${email}. You may also lodge a complaint with your national data protection authority.`,
      ].join("\n\n");
    case "returns":
      return [
        "## Right of withdrawal",
        "As a consumer in the EU you may cancel your purchase within 14 days after you (or someone you designated) received the item, without giving a reason.",
        "## How to return an item",
        `1. Tell us within 14 days by email at ${email}, mentioning your order number and the item.\n2. Send the item back within 14 days after telling us, well packed and in the condition you received it.\n3. Return shipping costs are for your account unless the item was not as described.`,
        "## Refund",
        "We refund the purchase price and the original standard shipping costs within 14 days after receiving your withdrawal, but we may wait until the item is back with us. We refund with the same payment method you used.",
        "## Condition of returned items",
        "You may handle the item as you would in a shop. If the item is damaged or has lost value because of handling beyond that, we may deduct the loss of value.",
        "## Return address",
        address,
      ].join("\n\n");
    case "shipping":
      return [
        "## Where we ship",
        `${shop} ships from ${or(v.country, "our home country")}. The countries we deliver to and the exact costs are shown at checkout.`,
        "## Shipping costs",
        "Shipping costs depend on the destination and the weight of your order. Insurance can be added for valuable items where available.",
        "## Delivery times",
        "We ship within 2 working days after payment. Delivery usually takes 1–3 working days within the country and 3–10 working days abroad.",
        "## Packaging",
        "Historical items are packed with care. Fragile items are double boxed.",
        "## Customs and legal restrictions",
        "For destinations outside the EU, import duties and taxes may apply; these are paid by the recipient. Some items may not be imported into every country — please check your local rules before ordering.",
        "## Questions",
        `Email ${email}.`,
      ].join("\n\n");
  }
}

/**
 * Who may use a shop's storefront (src/server/storefront/launch.ts): every visitor once it is live
 * (or when it predates the wizard); while it is "coming soon" only the tenant's own OWNERs.
 */
export function storefrontAccess(
  tenant: { id: string; setupState: unknown; setupCompletedAt: Date | null },
  viewer: { role: string; tenantId: string | null } | null,
): "open" | "staff-preview" | "coming-soon" {
  if (!isSetupPending(tenant)) return "open";
  return viewer && viewer.role === "OWNER" && viewer.tenantId === tenant.id ? "staff-preview" : "coming-soon";
}
