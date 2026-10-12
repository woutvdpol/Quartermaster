/*
 * Paid modules and packages (docs/modules.md) — the single source of what can be bought.
 * Pure (no server-only, no DB): the admin nav, the storefront, services, jobs and tests all read it.
 * Prices are provisional (cents, per month, excl. VAT).
 */
import type { NavItemKey } from "@/lib/admin-nav";

export const MODULE_IDS = [
  "auctions",
  "fairs",
  "offers",
  "coupons",
  "newsletter",
  "alerts",
  "leads",
  "smartSearch",
  "translations",
  "insights",
  "provenance",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export const PLAN_IDS = ["START", "PRO", "COMPLETE"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type ModuleDef = {
  id: ModuleId;
  name: string;
  description: string;
  priceCents: number;
  /** Admin sidebar items that belong to this module (shown locked without it). */
  navKeys: readonly NavItemKey[];
  /** Modules this one needs; buying it does not grant them. */
  requires: readonly ModuleId[];
  /** Background jobs and cron tasks that only run for shops with this module (documentation + tests). */
  jobs: readonly string[];
};

export const MODULES: Record<ModuleId, ModuleDef> = {
  auctions: {
    id: "auctions",
    name: "Auctions",
    description: "Auction days with single lots, live proxy bidding, bidder management and a winner payment link.",
    priceCents: 2500,
    navKeys: ["auctions"],
    requires: [],
    jobs: ["auctions.close-lot", "auctions.notify", "auctions.tick"],
  },
  fairs: {
    id: "fairs",
    name: "Fair mode",
    description: "Sell at fairs from a phone or tablet: QR labels, floor prices, offline sync and a fair report.",
    priceCents: 1000,
    navKeys: ["fairs"],
    requires: [],
    jobs: [],
  },
  offers: {
    id: "offers",
    name: "Make an offer",
    description: "Let buyers make an offer on a piece; accept, decline or counter it.",
    priceCents: 500,
    navKeys: ["offers"],
    requires: [],
    jobs: ["offers.expire"],
  },
  coupons: {
    id: "coupons",
    name: "Coupons",
    description: "Discount codes with redemption limits.",
    priceCents: 500,
    navKeys: ["coupons"],
    requires: [],
    jobs: [],
  },
  newsletter: {
    id: "newsletter",
    name: "Newsletter",
    description: "Subscribers, campaigns and a sign-up block and popup. Includes 5,000 mails per month.",
    priceCents: 1000,
    navKeys: ["newsletter"],
    requires: [],
    jobs: ["newsletter.campaign.batch"],
  },
  alerts: {
    id: "alerts",
    name: "Alerts & push",
    description: "Saved searches, price-drop and back-in-stock alerts by mail and web push.",
    priceCents: 1000,
    navKeys: ["alerts"],
    requires: [],
    jobs: ["alerts.match-product", "alerts.back-available", "alerts.price-drop", "alerts.digest", "alerts.scan", "push.send", "push.reservations", "push.flush"],
  },
  leads: {
    id: "leads",
    name: "Buy-in requests",
    description: "A “sell your collection” form with photos, and a list to follow up the requests.",
    priceCents: 500,
    navKeys: ["leads"],
    requires: [],
    jobs: ["leads.photos.cleanup"],
  },
  smartSearch: {
    id: "smartSearch",
    name: "Smart search",
    description: "Search by meaning and by photo, “similar items” and a duplicate photo check. Without it, plain text search.",
    priceCents: 2000,
    navKeys: [],
    requires: [],
    jobs: ["search.embed-product", "search.reindex-tenant", "search.sync"],
  },
  translations: {
    id: "translations",
    name: "Translations",
    description: "The shop in Dutch and German with machine translation, a review queue and a glossary.",
    priceCents: 1500,
    navKeys: ["translations"],
    requires: [],
    jobs: ["translations.sync", "translations.translate"],
  },
  insights: {
    id: "insights",
    name: "Insights",
    description: "Stock value, sell-through, what to buy more of, what has been sitting too long, one-click repricing.",
    priceCents: 1000,
    navKeys: ["insights"],
    requires: [],
    jobs: [],
  },
  provenance: {
    id: "provenance",
    name: "Provenance & certificates",
    description: "Suppliers, purchase records and margin, product documents and certificates of authenticity with a public verify page.",
    priceCents: 1000,
    navKeys: ["sourcing"],
    requires: [],
    jobs: [],
  },
};

/** Package limits; `null` = unlimited. Storage in GB, newsletter quota in mails per month. */
export type PlanLimits = {
  productLimit: number | null;
  photoLimit: number;
  storageGb: number;
  newsletterQuota: number | null;
};

export type PlanDef = {
  id: PlanId;
  name: string;
  /** The Concept500 tier this package replaces. */
  legacyTier: "bronze" | "silver" | "gold";
  priceCents: number;
  modules: readonly ModuleId[];
  limits: PlanLimits;
};

export const PLANS: Record<PlanId, PlanDef> = {
  START: {
    id: "START",
    name: "Start",
    legacyTier: "bronze",
    priceCents: 2900,
    modules: [],
    limits: { productLimit: 100, photoLimit: 3, storageGb: 5, newsletterQuota: 0 },
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    legacyTier: "silver",
    priceCents: 5900,
    modules: ["offers", "coupons", "newsletter", "alerts", "insights"],
    limits: { productLimit: 500, photoLimit: 5, storageGb: 20, newsletterQuota: 5000 },
  },
  COMPLETE: {
    id: "COMPLETE",
    name: "Complete",
    legacyTier: "gold",
    priceCents: 9900,
    modules: MODULE_IDS,
    limits: { productLimit: null, photoLimit: 20, storageGb: 50, newsletterQuota: 20000 },
  },
};

/** Mails per month the newsletter module adds when bought on top of a package without it. */
export const NEWSLETTER_MODULE_QUOTA = 5000;

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

/** The module an admin nav item belongs to, if any (core items return undefined). */
export function moduleForNavKey(key: NavItemKey): ModuleId | undefined {
  return MODULE_IDS.find((id) => MODULES[id].navKeys.includes(key));
}
