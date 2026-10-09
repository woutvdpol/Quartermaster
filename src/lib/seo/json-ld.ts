import { currencyExponent } from "@/components/shop/ui/money";
import { markdownToPlainText, renderMarkdown } from "@/server/content/markdown";
import { REST_OF_WORLD, isCountryCode } from "@/server/shipping/countries";
import { findTier, type QuoteZone } from "@/server/shipping/calc";
import type { PublicProduct, PublicStatus } from "@/server/storefront-catalog/types";
import { localizePath, type ShopLocale } from "@/lib/i18n/shop-locales";
import { productSpecs } from "./markdown-alternate";
import { squash, truncate } from "./text";

/*
 * schema.org JSON-LD builders (pure). Checked against Google's structured-data requirements for
 * Organization, Product snippets / merchant listings, BreadcrumbList, ItemList and FAQPage — see
 * docs/seo-geo.md for the field-by-field mapping and what is deliberately left out.
 *
 * Every builder returns a plain object; render it with <JsonLd> (escapes "<").
 * Node ids (`@id`) tie the graph together: the Organization is `{origin}/#organization`, the
 * WebSite `{origin}/#website`, a product `{productUrl}#product`.
 */

const SCHEMA = "https://schema.org";

/** Shop facts the builders need (built from ShopContext by `seoShop()` in src/server/seo). */
export type SeoShop = {
  origin: string;
  name: string;
  currency: string;
  description: string | null;
  logoPath: string | null;
  email: string;
  phone: string;
  address: { line1: string; line2: string; postalCode: string; city: string; country: string };
  sameAs: string[];
  vatNumber: string;
  cocNumber: string;
  /** null = the shop does not publish a return policy. */
  returns: ReturnPolicy | null;
};

/** days 0 = no returns. `countries` = where the policy applies (ISO alpha-2). */
export type ReturnPolicy = { days: number; fees: "customer" | "free"; countries: string[] };

export const orgId = (origin: string) => `${origin}/#organization`;
export const websiteId = (origin: string) => `${origin}/#website`;

const abs = (origin: string, path: string) => new URL(path, origin).toString();
/** Absolute URL of a shop path in a language ("/de/…"; English unprefixed). docs/i18n.md § Shop-routing. */
const absIn = (origin: string, path: string, locale: ShopLocale = "en") => abs(origin, localizePath(path, locale));

/** Minor units → "1450.00" (schema.org / Merchant Center decimal string). */
export function decimalPrice(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

function postalAddress(a: SeoShop["address"]) {
  const street = [a.line1, a.line2].map(squash).filter(Boolean).join(", ");
  if (!street && !a.city && !a.postalCode) return a.country ? { "@type": "PostalAddress", addressCountry: a.country } : null;
  return {
    "@type": "PostalAddress",
    ...(street ? { streetAddress: street } : {}),
    ...(a.postalCode ? { postalCode: a.postalCode } : {}),
    ...(a.city ? { addressLocality: a.city } : {}),
    ...(a.country ? { addressCountry: a.country } : {}),
  };
}

export function returnPolicyJsonLd(r: ReturnPolicy) {
  const countries = [...new Set(r.countries.filter(isCountryCode))].slice(0, 50);
  if (r.days <= 0) {
    return { "@type": "MerchantReturnPolicy", applicableCountry: countries, returnPolicyCategory: `${SCHEMA}/MerchantReturnNotPermitted` };
  }
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: countries,
    returnPolicyCategory: `${SCHEMA}/MerchantReturnFiniteReturnWindow`,
    merchantReturnDays: r.days,
    returnMethod: `${SCHEMA}/ReturnByMail`,
    returnFees: r.fees === "free" ? `${SCHEMA}/FreeReturn` : `${SCHEMA}/ReturnFeesCustomerResponsibility`,
  };
}

/** The shop as an OnlineStore (an Organization subtype Google recommends for online merchants). */
export function organizationJsonLd(shop: SeoShop) {
  const address = postalAddress(shop.address);
  const contact = shop.email || shop.phone;
  return {
    "@context": SCHEMA,
    "@type": "OnlineStore",
    "@id": orgId(shop.origin),
    name: shop.name,
    url: `${shop.origin}/`,
    ...(shop.logoPath ? { logo: { "@type": "ImageObject", url: abs(shop.origin, shop.logoPath) } } : {}),
    ...(shop.description ? { description: shop.description } : {}),
    ...(shop.email ? { email: shop.email } : {}),
    ...(shop.phone ? { telephone: shop.phone } : {}),
    ...(address ? { address } : {}),
    ...(contact
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer service",
            ...(shop.email ? { email: shop.email } : {}),
            ...(shop.phone ? { telephone: shop.phone } : {}),
            availableLanguage: "en",
          },
        }
      : {}),
    ...(shop.vatNumber ? { vatID: shop.vatNumber } : {}),
    ...(shop.cocNumber && shop.address.country === "NL" ? { identifier: { "@type": "PropertyValue", propertyID: "KvK", value: shop.cocNumber } } : {}),
    ...(shop.sameAs.length ? { sameAs: shop.sameAs } : {}),
    ...(shop.returns ? { hasMerchantReturnPolicy: returnPolicyJsonLd(shop.returns) } : {}),
  };
}

/** WebSite + SearchAction (the catalog search). */
export function websiteJsonLd(shop: Pick<SeoShop, "origin" | "name" | "description">, locale: ShopLocale = "en") {
  return {
    "@context": SCHEMA,
    "@type": "WebSite",
    "@id": websiteId(shop.origin),
    name: shop.name,
    url: `${shop.origin}/`,
    ...(shop.description ? { description: shop.description } : {}),
    inLanguage: locale,
    publisher: { "@id": orgId(shop.origin) },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${shop.origin}${localizePath("/shop", locale)}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export type ListItemInput = { href: string; name: string; image?: string | null };

/** CollectionPage (catalog / category / facet landing page) with its visible items as an ItemList. */
export function collectionPageJsonLd(input: {
  origin: string;
  path: string;
  name: string;
  description?: string | null;
  items: ListItemInput[];
  total: number;
  /** Page language: localised URLs + inLanguage (default English). */
  locale?: ShopLocale;
}) {
  const locale = input.locale ?? "en";
  const url = absIn(input.origin, input.path, locale);
  return {
    "@context": SCHEMA,
    "@type": "CollectionPage",
    "@id": url,
    url,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    inLanguage: locale,
    isPartOf: { "@id": websiteId(input.origin) },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: input.total,
      itemListElement: input.items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: absIn(input.origin, it.href, locale),
        name: it.name,
        ...(it.image ? { image: abs(input.origin, it.image) } : {}),
      })),
    },
  };
}

/** Product availability → schema.org ItemAvailability. */
export const AVAILABILITY: Record<PublicStatus, string> = {
  available: `${SCHEMA}/InStock`,
  // A held or reserved unique item cannot be bought right now (it may come back). schema.org has
  // "Reserved", but Google's merchant listings only accept the values it documents — OutOfStock is
  // the accurate one of those.
  reserved: `${SCHEMA}/OutOfStock`,
  sold: `${SCHEMA}/SoldOut`,
};

/**
 * OfferShippingDetails per active delivery zone with explicit countries (rest-of-world zones cannot
 * be expressed as a DefinedRegion and are left out). Rate = the zone's tier for the item's weight;
 * 0 when the price reaches the free-shipping threshold. Zones that cannot ship the weight are skipped.
 */
export function shippingDetailsJsonLd(
  zones: readonly QuoteZone[],
  input: { weightGrams: number; price: number; freeShippingThreshold: number; currency: string; blockedCountries?: readonly string[] },
) {
  const blocked = new Set(input.blockedCountries ?? []);
  const free = input.freeShippingThreshold > 0 && input.price >= input.freeShippingThreshold;
  const out: object[] = [];
  let regions = 0;
  for (const z of [...zones].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!z.isActive || z.isPickup) continue;
    // Countries a compliance rule closes for this item (NO_SHIPPING / HIDE_PRODUCT) are left out.
    const countries = z.countries.filter((c) => c !== REST_OF_WORLD && isCountryCode(c) && !blocked.has(c));
    if (!countries.length) continue;
    const tier = findTier(z.rates, Math.ceil(input.weightGrams));
    if (!tier) continue;
    const take = countries.slice(0, Math.max(0, 100 - regions));
    if (!take.length) break;
    regions += take.length;
    out.push({
      "@type": "OfferShippingDetails",
      shippingRate: { "@type": "MonetaryAmount", value: decimalPrice(free ? 0 : tier.price, input.currency), currency: input.currency },
      shippingDestination: take.map((c) => ({ "@type": "DefinedRegion", addressCountry: c })),
    });
  }
  return out;
}

/** Facet kinds with a schema.org home; everything else becomes additionalProperty. */
function facetValue(p: PublicProduct, kind: string): string | null {
  const f = p.facets.find((x) => x.facet.kind === kind);
  return f?.values[0]?.name ?? null;
}

export type ProductJsonLdExtras = {
  /** Page language: localised URL + inLanguage (default English). Pass the translated product. */
  locale?: ShopLocale;
  shipping?: object[];
  returns?: ReturnPolicy | null;
  /** The visitor may see the price (sold items only with Product.showSoldPrice, docs/sold-archive.md). */
  showPrice: boolean;
};

/**
 * schema.org Product + Offer for a product page that is not locked (sensitive item for a guest).
 * Pass `images: []` on the product when a compliance rule blurs its photos for the visitor.
 * Sold items without a visible price get no Offer (an Offer without price is invalid); with one, the
 * Offer says SoldOut (pass no shipping/returns for sold items).
 */
export function productJsonLd(shop: Pick<SeoShop, "origin" | "name" | "currency">, p: PublicProduct, status: PublicStatus, extras: ProductJsonLdExtras) {
  const locale = extras.locale ?? "en";
  const url = absIn(shop.origin, p.href, locale);
  const maker = facetValue(p, "MAKER");
  const country = facetValue(p, "COUNTRY");
  const description = p.description ? truncate(markdownToPlainText(p.description), 5000) : null;
  const { specs, condition } = productSpecs(p);
  const properties = [
    ...p.facets
      .filter((f) => f.facet.kind !== "MAKER")
      .map((f) => ({ "@type": "PropertyValue", name: f.facet.name, value: f.values.map((v) => v.path.join(" › ")).join(", ") })),
    ...specs.map((s) => ({ "@type": "PropertyValue", name: s.label, value: s.value })),
    ...(condition ? [{ "@type": "PropertyValue", name: "Condition", value: condition }] : []),
  ];
  const offer =
    status !== "sold" || extras.showPrice
      ? {
          "@type": "Offer",
          url,
          availability: AVAILABILITY[status],
          itemCondition: `${SCHEMA}/UsedCondition`,
          price: decimalPrice(p.price, shop.currency),
          priceCurrency: shop.currency,
          seller: { "@id": orgId(shop.origin) },
          ...(extras.shipping?.length ? { shippingDetails: extras.shipping } : {}),
          ...(extras.returns ? { hasMerchantReturnPolicy: returnPolicyJsonLd(extras.returns) } : {}),
        }
      : null;
  return {
    "@context": SCHEMA,
    "@type": "Product",
    "@id": `${url}#product`,
    name: p.title,
    url,
    inLanguage: locale,
    sku: p.sku ?? String(p.stockCode),
    productID: String(p.stockCode),
    ...(description ? { description } : {}),
    ...(p.images.length ? { image: p.images.slice(0, 10).map((i) => abs(shop.origin, i.large)) } : {}),
    ...(p.categoryPath.length ? { category: p.categoryPath.map((c) => c.title).join(" > ") } : {}),
    ...(maker ? { brand: { "@type": "Brand", name: maker }, manufacturer: { "@type": "Organization", name: maker } } : {}),
    ...(country ? { countryOfOrigin: { "@type": "Country", name: country } } : {}),
    ...(properties.length ? { additionalProperty: properties } : {}),
    itemCondition: `${SCHEMA}/UsedCondition`,
    ...(offer ? { offers: offer } : {}),
  };
}

// ─── FAQPage ─────────────────────────────────────────────────────────────────

export type FaqEntry = { question: string; answer: string };

/**
 * A Markdown answer as the HTML Google accepts in `Answer.text` (h1–h6, br, ol, ul, li, a, p, div,
 * b, strong, i, em; developers.google.com/search/docs/appearance/structured-data/faqpage). Our safe
 * Markdown subset only adds blockquote (unwrapped to its paragraph) and hr (dropped). Relative links
 * become absolute. A single plain paragraph is returned as plain text.
 */
export function faqAnswerText(markdown: string, origin: string): string {
  const html = renderMarkdown(markdown)
    .replace(/<\/?blockquote>/g, "")
    .replace(/<hr>\n?/g, "")
    .replace(/ rel="[^"]*"/g, "")
    .replace(/href="(\/[^"]*)"/g, (_, path: string) => `href="${abs(origin, path.replace(/&amp;/g, "&")).replace(/&/g, "&amp;")}"`)
    .trim();
  if (/^<p>[^<]*<\/p>$/.test(html)) return markdownToPlainText(markdown);
  return html;
}

/**
 * One FAQPage for all FAQ blocks of a page (Google: a page has at most one FAQPage). Questions that
 * appear twice are kept once. Null when there is nothing to mark up.
 *
 * Google shows FAQ rich results only for well-known government and health sites (since Aug 2023),
 * so shops will rarely get the rich result; the markup still gives search engines and AI assistants
 * the question/answer pairs explicitly (docs/seo-geo.md §3.4).
 */
export function faqPageJsonLd(entries: FaqEntry[], origin: string) {
  const seen = new Set<string>();
  const mainEntity = entries.flatMap((e) => {
    const name = squash(e.question);
    const key = name.toLowerCase();
    const text = faqAnswerText(e.answer, origin);
    if (!name || !text || seen.has(key)) return [];
    seen.add(key);
    return [{ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } }];
  });
  if (!mainEntity.length) return null;
  return { "@context": SCHEMA, "@type": "FAQPage", mainEntity };
}
