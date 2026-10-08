import { decimalPrice } from "./json-ld";
import { xmlEscape } from "./sitemap-xml";
import { squash, truncate } from "./text";

/*
 * Google Merchant Center product feed: RSS 2.0 with the `g:` namespace
 * (https://support.google.com/merchants/answer/7052112). Pure. Served at /feeds/google-merchant.xml.
 *
 * Only buyable items are listed (for sale right now — not reserved, not sold), never sensitive,
 * age-restricted, restricted-symbol or deactivated-weapon items (Shopping policies on weapons and
 * hate symbols would get the Merchant Center account suspended), never items a compliance rule
 * hides in the shop's own country. Every item is a used, unique antique without GTIN/MPN:
 * condition=used, identifier_exists=no.
 */

export type FeedItem = {
  stockCode: number;
  title: string;
  /** Plain text (markdown already stripped). */
  description: string;
  /** Absolute URLs. */
  link: string;
  images: string[];
  /** Minor units. */
  price: number;
  /** Root → leaf category titles. */
  categoryPath: string[];
  brand: string | null;
  weightGrams: number;
};

export type FeedShop = { name: string; origin: string; currency: string; description: string | null };

const TITLE_MAX = 150;
const DESCRIPTION_MAX = 5000;

function tag(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `<${name}>${xmlEscape(String(value))}</${name}>`;
}

export function feedItemXml(item: FeedItem, currency: string): string {
  const [image, ...more] = item.images;
  const description = squash(item.description) || item.title;
  return [
    "<item>",
    tag("g:id", item.stockCode),
    tag("g:title", truncate(item.title, TITLE_MAX)),
    tag("g:description", truncate(description, DESCRIPTION_MAX)),
    tag("g:link", item.link),
    tag("g:image_link", image),
    ...more.slice(0, 10).map((src) => tag("g:additional_image_link", src)),
    tag("g:availability", "in_stock"),
    tag("g:price", `${decimalPrice(item.price, currency)} ${currency}`),
    tag("g:condition", "used"),
    tag("g:identifier_exists", "no"),
    tag("g:brand", item.brand),
    tag("g:product_type", item.categoryPath.length ? item.categoryPath.join(" > ") : null),
    item.weightGrams > 0 ? tag("g:shipping_weight", `${item.weightGrams} g`) : "",
    "</item>",
  ].join("");
}

export function merchantFeedXml(shop: FeedShop, items: FeedItem[]): string {
  const channel = [
    tag("title", shop.name),
    tag("link", `${shop.origin}/`),
    tag("description", shop.description || `Items for sale at ${shop.name}`),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>${channel}\n${items
    .map((i) => feedItemXml(i, shop.currency))
    .join("\n")}${items.length ? "\n" : ""}</channel>\n</rss>\n`;
}
