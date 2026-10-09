import { formatMoney } from "@/components/shop/ui/money";
import { OG_LOCALE, localizePath, SOURCE_LOCALE, type ShopLocale } from "@/lib/i18n/shop-locales";
import { markdownToPlainText } from "@/server/content/markdown";
import type { PublicImage, PublicProduct } from "@/server/storefront-catalog/types";
import { decimalPrice } from "./json-ld";
import { STATUS_LABEL } from "./markdown-alternate";
import { metaDescription } from "./text";

/*
 * Metadata building blocks for product pages (pure). Catalog listings: src/components/shop/catalog/metadata.ts.
 */

/** "for sale at" in the generated description, per extra language (English: STATUS_LABEL). */
const GENERATED_STATUS: Record<Exclude<ShopLocale, "en">, Record<PublicProduct["status"], string>> = {
  nl: { available: "te koop bij", reserved: "gereserveerd bij", sold: "verkocht door" },
  de: { available: "erhältlich bei", reserved: "reserviert bei", sold: "verkauft von" },
};

/** Facet kinds shown in a generated description, in this order. */
const DESCRIPTION_KINDS = ["PERIOD", "COUNTRY", "BRANCH", "UNIT", "MAKER"];

/**
 * Meta description: the SEO description, else the description text, else a fact sentence
 * ("Title — Category; WW2, Germany. No. 123, €450.00, for sale at Shop."). Truncated to 160.
 */
export function productMetaDescription(p: PublicProduct, shopName: string, priceCurrency: string | null, locale: ShopLocale = SOURCE_LOCALE): string | undefined {
  const facts = DESCRIPTION_KINDS.flatMap((k) => p.facets.filter((f) => f.facet.kind === k).map((f) => f.values[0]?.name)).filter(Boolean);
  const category = p.categoryPath.at(-1)?.title;
  const head = [category, facts.join(", ")].filter(Boolean).join("; ");
  const price = priceCurrency ? `, ${formatMoney(p.price, priceCurrency, locale)}` : "";
  const status = locale === SOURCE_LOCALE ? `${STATUS_LABEL[p.status].toLowerCase()} at` : GENERATED_STATUS[locale][p.status];
  const generated = `${p.title}${head ? ` — ${head}` : ""}. ${locale === SOURCE_LOCALE ? "No." : "Nr."} ${p.stockCode}${price}, ${status} ${shopName}.`;
  return metaDescription(p.seoDescription, p.description ? markdownToPlainText(p.description) : null, generated);
}

/** The 2000w variant's real size (variants never upscale). */
export function largeVariantSize(img: Pick<PublicImage, "width" | "height">): { width?: number; height?: number } {
  if (!img.width || !img.height) return {};
  if (img.width <= 2000) return { width: img.width, height: img.height };
  return { width: 2000, height: Math.round((img.height * 2000) / img.width) };
}

/** Open Graph image for a product: its main photo (large variant), or null without photos. */
export function productOgImage(p: PublicProduct): { url: string; width?: number; height?: number; alt: string } | null {
  const img = p.images[0];
  if (!img) return null;
  return { url: img.large, ...largeVariantSize(img), alt: img.alt ?? p.title };
}

/**
 * og:type=product and the product:* tags (Open Graph product namespace, read by Facebook/Pinterest
 * catalogs). Rendered through `metadata.other` (Next has no "product" OG type), i.e. as
 * <meta name="…">; Facebook's parser accepts name= as well as property=.
 */
export function productOgTags(p: PublicProduct, currency: string, showPrice: boolean): Record<string, string> {
  return {
    "og:type": "product",
    "product:retailer_item_id": String(p.stockCode),
    "product:condition": "used",
    "product:availability": p.status === "available" ? "in stock" : "out of stock",
    ...(showPrice ? { "product:price:amount": decimalPrice(p.price, currency), "product:price:currency": currency } : {}),
  };
}

/** Shop fields the Open Graph defaults need (structural: ShopContext fits). */
export type OgShop = { shopName: string; settings: { appearance: { bannerPath: string | null } }; locale?: ShopLocale; locales?: readonly ShopLocale[] };

/**
 * Open Graph defaults for every shop page. Next replaces the layout's `openGraph` as a whole when a
 * page sets its own, so pages spread these in to keep site name, locale and a preview image.
 */
export function shopOgDefaults(shop: OgShop) {
  const banner = shop.settings.appearance.bannerPath;
  return {
    type: "website" as const,
    siteName: shop.shopName,
    locale: OG_LOCALE[shop.locale ?? SOURCE_LOCALE],
    ...(shop.locales && shop.locales.length > 1
      ? { alternateLocale: shop.locales.filter((l) => l !== (shop.locale ?? SOURCE_LOCALE)).map((l) => OG_LOCALE[l]) }
      : {}),
    // Banner image, or a generated card (shop name + description; src/app/og/shop).
    images: [banner ? { url: banner } : { url: "/og/shop", width: 1200, height: 630, alt: shop.shopName }],
  };
}

/**
 * `alternates` for an indexable shop page in the request language (docs/i18n.md § Shop-routing):
 * canonical = the page in this language ("/de/shop"), plus hreflang links to every served language and
 * x-default (English) when the shop serves more than one. `path` is the unprefixed page path, query
 * included when it is part of the canonical ("/shop?page=2"). Relative URLs resolve via metadataBase.
 * `types` (e.g. the Markdown alternate) are passed through.
 */
export function shopAlternates(
  shop: { locale: ShopLocale; locales: readonly ShopLocale[] },
  path: string,
  types?: Record<string, string>,
): { canonical: string; languages?: Record<string, string>; types?: Record<string, string> } {
  const languages =
    shop.locales.length > 1
      ? Object.fromEntries([...shop.locales.map((l) => [l, localizePath(path, l)] as const), ["x-default", localizePath(path, SOURCE_LOCALE)] as const])
      : undefined;
  return { canonical: localizePath(path, shop.locale), ...(languages ? { languages } : {}), ...(types ? { types } : {}) };
}
