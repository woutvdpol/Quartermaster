import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeCsvBytes, parseCsv } from "@/server/import/csv";
import { parseWooCommerce, splitWooList, unescapeWooCell } from "@/server/import/woocommerce";
import { parseShopify } from "@/server/import/shopify";
import { MAX_SPLIT_UNITS, descriptionMarkdown, parsePriceMinor, planProduct, summarisePlans } from "@/server/import/mapping";
import { DEFAULT_IMPORT_OPTIONS, ImportFormatError, type ImportOptions, type SourceProduct } from "@/server/import/types";
import { htmlToMarkdown } from "@/server/content/html-markdown";

const fixture = (name: string) => parseCsv(decodeCsvBytes(fs.readFileSync(path.join(__dirname, "fixtures", name))));
const opts = (o: Partial<ImportOptions> = {}): ImportOptions => ({ ...DEFAULT_IMPORT_OPTIONS, ...o });

describe("WooCommerce parser", () => {
  const parsed = parseWooCommerce(fixture("woocommerce-products.csv"));
  const byTitle = (t: string) => parsed.products.find((p) => p.title.startsWith(t))!;

  it("reads products, skips grouped products and variations with reasons", () => {
    expect(parsed.rows).toBe(10);
    expect(parsed.products.map((p) => p.sourceId)).toEqual(["id:101", "id:102", "id:103", "id:104", "id:108", "id:109", "id:110"]);
    expect(parsed.skipped.map((s) => s.row)).toEqual([8, 6, 7]);
    expect(parsed.skipped.find((s) => s.row === 8)!.message).toMatch(/grouped/);
    expect(parsed.skipped.find((s) => s.row === 6)!.message).toMatch(/Variation of “Reproduction Feldmütze M34”/);
  });

  it("maps the standard columns", () => {
    const m35 = byTitle("M35 Stahlhelm");
    expect(m35).toMatchObject({
      row: 2,
      sku: "DM-H-0101",
      published: true,
      regularPrice: "1250",
      categories: [["Helmets", "German"]],
      tags: ["WW2", "Germany", "Heer"],
      stock: 1,
      weightGrams: 1100,
      seoDescription: "Original M35 Stahlhelm with Heer decal.",
      variants: 0,
      needsReview: false,
    });
    expect(m35.images).toHaveLength(2);
    expect(m35.descriptionHtml).toContain('"field grey"');
  });

  it("handles stock, sale prices, several categories and out-of-stock items", () => {
    const p37 = byTitle("British P37");
    expect(p37).toMatchObject({ stock: 3, salePrice: "149.50", regularPrice: "185.00" });
    expect(p37.warnings.join()).toMatch(/Several categories/);
    expect(byTitle("US M1 helmet liner").stock).toBe(0);
    expect(byTitle("Dutch M27").stock).toBeNull(); // not tracked
    expect(byTitle("Dutch M27").sourceId).toBe("id:110");
  });

  it("folds variations into a variable parent (price from the first variation, review flag)", () => {
    const cap = byTitle("Reproduction Feldmütze");
    expect(cap).toMatchObject({ regularPrice: "45", variants: 2, needsReview: true });
    expect(cap.warnings.join(" ")).toMatch(/2 variations/);
  });

  it("undoes WooCommerce escaping (\\, in lists, formula prefix, literal \\n)", () => {
    const ssh = byTitle("Soviet SSh-40");
    expect(ssh.tags).toEqual(["WW2", "Soviet Union", "Pristine, unissued"]);
    expect(ssh.shortDescriptionHtml).toBe("- Unissued, maker marked");
    expect(ssh.descriptionHtml).toBe("Dated 1943.\nPaint 95%, liner complete.");
    expect(ssh.published).toBe(false);
    expect(splitWooList("a\\, b, c")).toEqual(["a, b", "c"]);
    expect(unescapeWooCell("'=1+1")).toBe("=1+1");
    expect(unescapeWooCell("'quoted")).toBe("'quoted");
  });

  it("refuses a file that is not a WooCommerce export", () => {
    expect(() => parseWooCommerce(fixture("shopify-products.csv"))).toThrow(ImportFormatError);
  });
});

describe("Shopify parser", () => {
  const parsed = parseShopify(fixture("shopify-products.csv"));
  const byHandle = (h: string) => parsed.products.find((p) => p.sourceId === `handle:${h}`)!;

  it("groups rows by Handle and orders images by position", () => {
    expect(parsed.products.map((p) => p.sourceId)).toEqual([
      "handle:french-m15-adrian-helmet",
      "handle:us-m1943-field-jacket",
      "handle:reenactor-ankle-boots",
      "handle:french-kepi-1914",
    ]);
    const adrian = byHandle("french-m15-adrian-helmet");
    expect(adrian.images.map((u) => u.split("/").pop())).toEqual(["adrian-front.jpg", "adrian-side.jpg"]);
    expect(adrian).toMatchObject({ sku: "SH-0001", stock: 1, weightGrams: 750, categories: [["Helmets"]], published: true, seoTitle: "French Adrian helmet M15" });
  });

  it("treats Compare At Price as the regular price (on sale) and maps cost", () => {
    expect(byHandle("us-m1943-field-jacket")).toMatchObject({ regularPrice: "300.00", salePrice: "260.00", costPrice: "120.00", stock: 2 });
  });

  it("folds variants into one draft item and skips gift cards", () => {
    const boots = byHandle("reenactor-ankle-boots");
    expect(boots).toMatchObject({ variants: 2, needsReview: true, sku: "SH-0003-43", stock: 4 });
    expect(boots.images.map((u) => u.split("/").pop())).toEqual(["boots.jpg", "boots-44.jpg"]);
    expect(parsed.skipped.map((s) => s.message).join()).toMatch(/gift card/);
  });

  it("uses the taxonomy leaf without a Type, archived = not published", () => {
    expect(byHandle("french-kepi-1914")).toMatchObject({ categories: [["Hats"]], published: false });
  });
});

describe("mapping", () => {
  const base: SourceProduct = {
    sourceId: "id:1",
    row: 2,
    title: "  Helmet   ",
    descriptionHtml: "<p>Long <b>text</b></p><script>alert(1)</script><img src=x>",
    shortDescriptionHtml: "<p>Short</p>",
    sku: "A-1",
    published: true,
    regularPrice: "100",
    salePrice: "",
    costPrice: "",
    categories: [["Helmets", "German"]],
    tags: ["WW2", "wW2", "Germany"],
    images: ["https://a.example/1.jpg", "javascript:alert(1)", "http://a.example/2.jpg"],
    stock: 1,
    weightGrams: 900,
    seoTitle: "",
    seoDescription: "<b>SEO</b> text",
    variants: 0,
    needsReview: false,
    warnings: [],
  };

  it("parses prices into minor units", () => {
    expect(parsePriceMinor("1250")).toBe(125000);
    expect(parsePriceMinor("149.5")).toBe(14950);
    expect(parsePriceMinor("149.505")).toBe(14951);
    expect(parsePriceMinor("1.234,50")).toBe(123450);
    expect(parsePriceMinor("12,50")).toBe(1250);
    expect(parsePriceMinor("1000", 0)).toBe(1000);
    expect(parsePriceMinor("")).toBeNull();
    expect(parsePriceMinor("abc")).toBeNull();
    expect(parsePriceMinor("-5")).toBeNull();
  });

  it("converts HTML to Markdown without raw HTML or images", () => {
    expect(descriptionMarkdown(base)).toBe("Short\n\nLong **text**");
    expect(htmlToMarkdown("<ol><li>One</li><li>Two</li></ol>")).toBe("1. One\n2. Two");
  });

  it("plans a simple product", () => {
    const p = planProduct(base, opts({ publish: true, tagsAs: "tags" }), { digits: 2 });
    expect(p).toMatchObject({
      title: "Helmet",
      price: 10000,
      onSale: false,
      units: 1,
      quantity: 1,
      status: "ACTIVE",
      tags: ["WW2", "Germany"],
      categoryPath: ["Helmets", "German"],
      weightGrams: 900,
      seoDescription: "SEO text",
    });
    expect(p.images).toEqual(["https://a.example/1.jpg", "http://a.example/2.jpg"]);
    expect(p.warnings.join()).toMatch(/not http/);
  });

  it("sale price wins and sets onSale", () => {
    const p = planProduct({ ...base, salePrice: "80" }, opts(), { digits: 2 });
    expect(p).toMatchObject({ price: 8000, regularPrice: 10000, onSale: true, status: "DRAFT" });
  });

  it("matches tags to facet values when asked", () => {
    const matchFacet = (t: string) => (t.toLowerCase() === "ww2" ? { valueId: "v1", facet: "Period", value: "WW2" } : null);
    const p = planProduct(base, opts({ tagsAs: "facets" }), { digits: 2, matchFacet });
    expect(p.facets).toEqual([{ valueId: "v1", facet: "Period", value: "WW2" }]);
    expect(p.tags).toEqual(["Germany"]);
    expect(planProduct(base, opts({ tagsAs: "tags" }), { digits: 2, matchFacet }).facets).toEqual([]);
  });

  it("splits stock > 1 or keeps one item", () => {
    expect(planProduct({ ...base, stock: 3 }, opts({ stockMode: "split" }), { digits: 2 }).units).toBe(3);
    const single = planProduct({ ...base, stock: 3 }, opts({ stockMode: "single" }), { digits: 2 });
    expect(single.units).toBe(1);
    expect(single.warnings.join()).toMatch(/one unique item/);
    expect(planProduct({ ...base, stock: 500 }, opts(), { digits: 2 }).units).toBe(MAX_SPLIT_UNITS);
  });

  it("never publishes out-of-stock, unpriced, unpublished or review items", () => {
    const o = opts({ publish: true });
    expect(planProduct({ ...base, stock: 0 }, o, { digits: 2 })).toMatchObject({ quantity: 0, status: "DRAFT" });
    expect(planProduct({ ...base, regularPrice: "" }, o, { digits: 2 }).status).toBe("DRAFT");
    expect(planProduct({ ...base, published: false }, o, { digits: 2 }).status).toBe("DRAFT");
    expect(planProduct({ ...base, needsReview: true }, o, { digits: 2 }).status).toBe("DRAFT");
  });

  it("summarises the WooCommerce fixture", () => {
    const parsed = parseWooCommerce(fixture("woocommerce-products.csv"));
    const plans = parsed.products.map((p) => planProduct(p, opts({ publish: true }), { digits: 2 }));
    const sum = summarisePlans(plans, parsed.products);
    expect(sum).toMatchObject({ products: 7, items: 9, itemsIfSplit: 9, itemsIfSingle: 7, multiStock: 1 });
    // M35, P37 ×3 (split), Kriegsmarine buckle, Dutch M27 → published; liner (no stock), cap (review), SSh-40 (unpublished) → drafts
    expect(sum.publish).toBe(6);
    expect(sum.images).toBe(9);
    expect(sum.categoryPaths.map((p) => p.join(">"))).toContain("Helmets>German");
    expect(sum.categoryPaths.map((p) => p.join(">"))).toContain("Helmets");
  });
});

describe("mapping — variants", () => {
  it("never splits a product with variants", () => {
    const parsed = parseShopify(parseCsv(decodeCsvBytes(fs.readFileSync(path.join(__dirname, "fixtures", "shopify-products.csv")))));
    const boots = parsed.products.find((p) => p.sourceId === "handle:reenactor-ankle-boots")!;
    expect(planProduct(boots, opts({ stockMode: "split", publish: true }), { digits: 2 })).toMatchObject({ units: 1, status: "DRAFT" });
    const sum = summarisePlans(parsed.products.map((p) => planProduct(p, opts(), { digits: 2 })), parsed.products);
    expect(sum).toMatchObject({ items: 5, itemsIfSplit: 5, multiStock: 1 });
  });
});
