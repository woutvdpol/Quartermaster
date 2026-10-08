import { describe, expect, it } from "vitest";
import { feedItemXml, merchantFeedXml, type FeedItem } from "./merchant-feed";

const item: FeedItem = {
  stockCode: 1234,
  title: "German M35 helmet <rare>",
  description: "Original helmet & liner.",
  link: "https://s.example/product/1234/m35",
  images: Array.from({ length: 13 }, (_, i) => `https://s.example/uploads/${i}.webp`),
  price: 45000,
  categoryPath: ["Helmets", "German"],
  brand: "Quist",
  weightGrams: 1200,
};

describe("merchant feed", () => {
  it("writes the required g: attributes for a used, unique item", () => {
    const xml = feedItemXml(item, "EUR");
    expect(xml).toContain("<g:id>1234</g:id>");
    expect(xml).toContain("<g:title>German M35 helmet &lt;rare&gt;</g:title>");
    expect(xml).toContain("<g:description>Original helmet &amp; liner.</g:description>");
    expect(xml).toContain("<g:link>https://s.example/product/1234/m35</g:link>");
    expect(xml).toContain("<g:image_link>https://s.example/uploads/0.webp</g:image_link>");
    expect(xml.match(/<g:additional_image_link>/g)).toHaveLength(10);
    expect(xml).toContain("<g:availability>in_stock</g:availability>");
    expect(xml).toContain("<g:price>450.00 EUR</g:price>");
    expect(xml).toContain("<g:condition>used</g:condition>");
    expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
    expect(xml).toContain("<g:brand>Quist</g:brand>");
    expect(xml).toContain("<g:product_type>Helmets &gt; German</g:product_type>");
    expect(xml).toContain("<g:shipping_weight>1200 g</g:shipping_weight>");
  });

  it("omits optional attributes and falls back to the title as description", () => {
    const xml = feedItemXml({ ...item, brand: null, categoryPath: [], weightGrams: 0, description: "  " }, "EUR");
    expect(xml).not.toContain("g:brand");
    expect(xml).not.toContain("g:product_type");
    expect(xml).not.toContain("g:shipping_weight");
    expect(xml).toContain("<g:description>German M35 helmet &lt;rare&gt;</g:description>");
  });

  it("wraps items in an RSS 2.0 channel with the g namespace", () => {
    const xml = merchantFeedXml({ name: "Shop & Co", origin: "https://s.example", currency: "EUR", description: null }, [item]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">')).toBe(true);
    expect(xml).toContain("<title>Shop &amp; Co</title><link>https://s.example/</link>");
    expect(xml.match(/<item>/g)).toHaveLength(1);
  });
});
