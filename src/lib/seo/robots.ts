import type { MetadataRoute } from "next";
import { THEME_PREVIEW_PARAM } from "@/lib/theme-preview";
import { AI_SEARCH_BOTS, AI_TRAINING_BOTS } from "./bots";

/*
 * robots.txt rules (pure; src/app/robots.ts picks the variant per host). docs/seo-geo.md.
 *
 * Disallow only what must not be crawled (private / per-visitor pages and crawl traps). Pages that
 * are crawlable but must not be indexed (filtered catalog views, login, register) carry a
 * `noindex` meta tag instead — a robots.txt block would hide that tag from crawlers.
 */

/** Per-visitor or private storefront paths (prefix match). Every page here also renders `noindex`. */
export const SHOP_PRIVATE_PATHS = [
  "/admin",
  "/api/",
  "/cart",
  "/checkout",
  "/account",
  "/wishlist",
  "/order/",
  "/offer/",
  "/alerts/",
  "/newsletter/confirm",
  "/verify/",
  "/login/2fa",
  "/qm-unmatched",
] as const;

/** Crawl traps: search results, re-sorted lists, stacked filters and theme previews. */
export const SHOP_CRAWL_TRAPS = [
  "/*?*q=",
  "/*?*sort=",
  "/*?*view=",
  "/*?*f=*&f=",
  "/*?*tag=*&tag=",
  `/*?*${THEME_PREVIEW_PARAM}=`,
] as const;

const DISALLOW_ALL: MetadataRoute.Robots = { rules: { userAgent: "*", disallow: "/" } };

export function closedRobots(): MetadataRoute.Robots {
  return DISALLOW_ALL;
}

export type ShopRobotsInput = {
  origin: string;
  /** settings content.seo.allowAiTraining */
  allowAiTraining: boolean;
};

/** robots.txt for a live shop host. */
export function shopRobots({ origin, allowAiTraining }: ShopRobotsInput): MetadataRoute.Robots {
  const disallow = [...SHOP_PRIVATE_PATHS, ...SHOP_CRAWL_TRAPS];
  const rules: MetadataRoute.Robots["rules"] = [
    { userAgent: "*", allow: "/", disallow },
    // AI search / answer engines: explicitly welcome (same rules as everyone). Training crawlers join
    // this group unless the shop opted out.
    { userAgent: [...AI_SEARCH_BOTS, ...(allowAiTraining ? AI_TRAINING_BOTS : [])], allow: "/", disallow },
  ];
  if (!allowAiTraining) rules.push({ userAgent: [...AI_TRAINING_BOTS], disallow: "/" });
  return { rules, sitemap: new URL("/sitemap.xml", origin).toString() };
}

/** robots.txt for the platform host: the landing + application pages are public, the rest is not. */
/** NETWORK_HOST (Quartermaster network on its own host, docs/network.md): only the network pages. */
export function networkRobots(origin: string): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/qm-unmatched"] },
    sitemap: new URL("/sitemap.xml", origin).toString(),
  };
}

export function platformRobots(origin: string): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/apply/", "/qm-unmatched"] },
    sitemap: new URL("/sitemap.xml", origin).toString(),
  };
}
