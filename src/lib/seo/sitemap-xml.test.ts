import { describe, expect, it } from "vitest";
import { latest, parseSitemapFile, sitemapFileName, sitemapIndexXml, urlsetXml, w3cDate, xmlEscape } from "./sitemap-xml";

describe("sitemap XML", () => {
  it("escapes XML", () => {
    expect(xmlEscape(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
  });

  it("writes an index with lastmod", () => {
    const xml = sitemapIndexXml([{ loc: "https://s.example/sitemaps/pages.xml", lastmod: "2026-01-02T03:04:05.000Z" }, { loc: "https://s.example/sitemaps/products-1.xml" }]);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<sitemap><loc>https://s.example/sitemaps/pages.xml</loc><lastmod>2026-01-02T03:04:05.000Z</lastmod></sitemap>");
    expect(xml).toContain("<sitemap><loc>https://s.example/sitemaps/products-1.xml</loc></sitemap>");
  });

  it("writes a urlset with image entries only when needed", () => {
    expect(urlsetXml([{ loc: "https://s.example/" }])).not.toContain("xmlns:image");
    const xml = urlsetXml([{ loc: "https://s.example/product/1/a?x=1&y=2", lastmod: new Date("2026-01-01T00:00:00Z"), images: ["https://s.example/uploads/a.webp"] }]);
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).toContain("<loc>https://s.example/product/1/a?x=1&amp;y=2</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod>");
    expect(xml).toContain("<image:image><image:loc>https://s.example/uploads/a.webp</image:loc></image:image>");
    expect(urlsetXml([])).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
  });

  it("caps images per URL", () => {
    const xml = urlsetXml([{ loc: "https://s.example/p", images: Array.from({ length: 15 }, (_, i) => `https://s.example/${i}.webp`) }]);
    expect(xml.match(/<image:image>/g)).toHaveLength(10);
  });

  it("parses and names sitemap files", () => {
    expect(parseSitemapFile("pages.xml")).toEqual({ kind: "pages" });
    expect(parseSitemapFile("products-3.xml")).toEqual({ kind: "products", chunk: 3 });
    for (const bad of ["products-0.xml", "products.xml", "../x.xml", "pages.txt", "facets"]) expect(parseSitemapFile(bad)).toBeNull();
    expect(sitemapFileName({ kind: "products", chunk: 2 })).toBe("products-2.xml");
  });

  it("dates", () => {
    expect(w3cDate("nope")).toBeNull();
    expect(latest(["2026-01-01T00:00:00Z", null, "2026-03-01T00:00:00Z"])).toBe("2026-03-01T00:00:00.000Z");
    expect(latest([])).toBeNull();
  });
});
