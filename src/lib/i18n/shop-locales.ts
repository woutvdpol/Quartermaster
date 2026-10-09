/*
 * Shop languages and locale-prefixed URLs (docs/i18n.md § Shop-routing). Pure: used by src/proxy.ts,
 * server code, client components and tests.
 *
 *  - English is the shop's main (source) language and has NO prefix:  /shop, /product/1/helmet
 *  - Dutch and German live under a prefix:                              /nl/shop, /de/product/1/helmet
 *  - Only the languages a shop enables (settings.i18n.locales) are served; others 404.
 *
 * The proxy rewrites "/de/x" to the internal route "/x" and tells the app the language through the
 * LOCALE_HEADER request header (the route tree is not duplicated). Links therefore keep their
 * unprefixed form in data (productHref etc.) and are localised when rendered (localizePath).
 */

export const SHOP_LOCALES = ["en", "nl", "de"] as const;
export type ShopLocale = (typeof SHOP_LOCALES)[number];
/** The source language: no URL prefix, the text every translation is made from. */
export const SOURCE_LOCALE = "en" satisfies ShopLocale;
/** Languages a shop can switch on (settings.i18n.locales). */
export const EXTRA_LOCALES = ["nl", "de"] as const satisfies readonly ShopLocale[];
export type ExtraLocale = (typeof EXTRA_LOCALES)[number];

/** Request header the proxy sets on prefixed requests ("nl" | "de"); never trusted from the client. */
export const LOCALE_HEADER = "x-qm-locale";

/** Intl locale per shop language. en-IE gives "€1,450.00"; nl-NL "€ 1.450,00"; de-DE "1.450,00 €". */
export const INTL_LOCALE: Record<ShopLocale, string> = { en: "en-IE", nl: "nl-NL", de: "de-DE" };
/** Open Graph og:locale values. */
export const OG_LOCALE: Record<ShopLocale, string> = { en: "en_IE", nl: "nl_NL", de: "de_DE" };
/** Language names in their own language (language switcher). */
export const LOCALE_NAMES: Record<ShopLocale, string> = { en: "English", nl: "Nederlands", de: "Deutsch" };

export function isShopLocale(value: unknown): value is ShopLocale {
  return typeof value === "string" && (SHOP_LOCALES as readonly string[]).includes(value);
}

export function isExtraLocale(value: unknown): value is ExtraLocale {
  return typeof value === "string" && (EXTRA_LOCALES as readonly string[]).includes(value);
}

/** Header value → locale ("en" for missing/invalid values). */
export function parseLocaleHeader(value: string | null | undefined): ShopLocale {
  return isExtraLocale(value) ? value : SOURCE_LOCALE;
}

/** Served languages of a shop: always English first, then the enabled extras in a fixed order. */
export function servedLocales(enabled: readonly unknown[] | null | undefined): ShopLocale[] {
  const on = new Set((enabled ?? []).filter(isExtraLocale));
  return [SOURCE_LOCALE, ...EXTRA_LOCALES.filter((l) => on.has(l))];
}

/*
 * First path segments that are never localised: admin, APIs, files, feeds, SEO/AI endpoints and the
 * network. "/de/admin" is therefore not rewritten and 404s like any unknown path.
 */
const UNLOCALIZED_SEGMENTS = new Set([
  "admin",
  "api",
  "_next",
  "uploads",
  "fonts",
  "feeds",
  "sitemaps",
  "sitemap.xml",
  "robots.txt",
  "og",
  "pwa-icon",
  "manifest.webmanifest",
  "llms.txt",
  "llms-full.txt",
  "md",
  "sw.js",
  "favicon.ico",
  "network",
  "qm-unmatched",
  ".well-known",
]);

/** Can this (unprefixed) path exist in another language? Only shop pages can. */
export function isLocalizablePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  const pathname = path.split(/[?#]/, 1)[0];
  const first = pathname.split("/")[1] ?? "";
  if (UNLOCALIZED_SEGMENTS.has(first)) return false;
  // Markdown alternates (/product/1.md, /about.md) are English only.
  return !pathname.endsWith(".md");
}

export type LocalePath = {
  /** Language of the URL (English when unprefixed). */
  locale: ShopLocale;
  /** The path without the language prefix ("/" for "/de"). Query and hash are kept. */
  path: string;
  /** The URL carried a prefix ("/de/…", or the never-served "/en/…"). */
  prefixed: boolean;
};

/** "/de/shop?x=1" → { locale: "de", path: "/shop?x=1", prefixed: true }. "/en/…" reports locale "en", prefixed. */
export function splitLocalePath(url: string): LocalePath {
  const m = /^\/(en|nl|de)(?=$|[/?#])(.*)$/.exec(url);
  if (!m) return { locale: SOURCE_LOCALE, path: url, prefixed: false };
  const rest = m[2];
  const path = rest === "" ? "/" : rest.startsWith("/") ? rest : `/${rest}`;
  return { locale: m[1] as ShopLocale, path, prefixed: true };
}

/**
 * A same-site path in `locale`: localizePath("/shop?x=1", "de") → "/de/shop?x=1", ("/", "nl") → "/nl".
 * Idempotent and switchable: an existing prefix is replaced ("/nl/shop", "de" → "/de/shop"; "en" → "/shop").
 * External URLs, protocol-relative URLs, hashes and unlocalisable paths (admin, uploads, …) are returned as is.
 */
export function localizePath(href: string, locale: ShopLocale): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const { path } = splitLocalePath(href);
  if (locale === SOURCE_LOCALE || !isLocalizablePath(path)) return path;
  if (path === "/") return `/${locale}`;
  if (path.startsWith("/?") || path.startsWith("/#")) return `/${locale}${path.slice(1)}`;
  return `/${locale}${path}`;
}

/** Absolute URL of `path` in `locale` on `origin` (canonical, hreflang, sitemap). */
export function localizedUrl(origin: string, path: string, locale: ShopLocale): string {
  return new URL(localizePath(path, locale), origin).toString();
}

/** hreflang map for one page: { en: abs, nl: abs, de: abs, "x-default": abs(en) } over the served locales. */
export function hreflangAlternates(origin: string, path: string, locales: readonly ShopLocale[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of locales) out[l] = localizedUrl(origin, path, l);
  out["x-default"] = localizedUrl(origin, path, SOURCE_LOCALE);
  return out;
}

/** A `locale` query param (API calls from the shop UI) → a language the shop serves, else English. */
export function servedLocaleParam(value: string | null | undefined, served: readonly ShopLocale[]): ShopLocale {
  return isExtraLocale(value) && served.includes(value) ? value : SOURCE_LOCALE;
}
