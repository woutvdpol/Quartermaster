import { describe, expect, it } from "vitest";
import { pageMarkdown, productMarkdown, returnsSummary } from "./markdown-alternate";
import { shippingLines } from "./shipping-lines";
import { ZONES, productFixture } from "./__tests__/fixtures";

const shop = { name: "Example Militaria", origin: "https://s.example", currency: "EUR", country: "NL" };

describe("productMarkdown", () => {
  it("renders facts in a predictable order", () => {
    const md = productMarkdown({
      shop,
      product: productFixture(),
      status: "available",
      showPrice: true,
      showImages: true,
      provenance: { text: "Ex collection Smith.", certificateIncluded: true, authenticityGuaranteed: false },
      shippingLines: shippingLines(ZONES, { weightGrams: 1200, price: 45000, freeShippingThreshold: 0, currency: "EUR" }),
      returnsLine: returnsSummary({ days: 14, fees: "customer" }),
      disclaimer: null,
    });
    const facts = md.split("\n").filter((l) => l.startsWith("- **")).map((l) => l.replace(/^- \*\*(.+?):\*\*.*$/, "$1"));
    expect(facts).toEqual(["No.", "Price", "Availability", "Condition", "Category", "Period", "Maker", "Country", "Size", "Shipping weight", "Seller", "URL"]);
    expect(md).toMatch(/^# German M35 helmet\n/);
    expect(md).toContain("- **Price:** €450.00 (EUR)");
    expect(md).toContain("- **Condition:** Used — Very good; unique item (one piece)");
    expect(md).toContain("- **URL:** https://s.example/product/1234/m35-helmet");
    expect(md).toContain("## Provenance and authenticity\n\nEx collection Smith.");
    expect(md).toContain("- Shipping to Benelux: €6.95");
    expect(md).toContain("- Pickup (Pickup in store): free");
    expect(md).not.toContain("Inactive");
    expect(md).toContain("- Returns accepted within 14 days of delivery; return shipping paid by the buyer.");
    expect(md).toContain("![Liner](https://s.example/uploads/b/large.webp)");
  });

  it("gives sold items no price unless shown per item, and withholds blurred photos", () => {
    const md = productMarkdown({ shop, product: productFixture({ status: "sold" }), status: "sold", showPrice: false, soldMonth: "Oct 2026", showImages: false, provenance: null, shippingLines: [], returnsLine: null, disclaimer: "Sold as collectible." });
    expect(md).not.toContain("- **Price:**");
    expect(md).not.toContain("- **Sold for:**");
    expect(md).not.toContain("€");
    expect(md).toContain("- **Availability:** Sold (Oct 2026); no longer for sale, kept as a reference");
    expect(md).not.toContain("## Photos");
    expect(md).not.toContain("## Shipping and returns");
    expect(md.trimEnd().endsWith("Sold as collectible.")).toBe(true);
  });

  it("shows the sold price of a sold item when the dealer ticked it", () => {
    const md = productMarkdown({ shop, product: productFixture({ status: "sold", showSoldPrice: true }), status: "sold", showPrice: true, soldMonth: null, showImages: true, provenance: null, shippingLines: [], returnsLine: null, disclaimer: null });
    expect(md).toContain("- **Sold for:** €450.00 (EUR)");
    expect(md).not.toContain("- **Price:**");
    expect(md).toContain("- **Availability:** Sold; no longer for sale, kept as a reference");
  });
});

describe("returnsSummary", () => {
  it("covers all policies", () => {
    expect(returnsSummary(null)).toBeNull();
    expect(returnsSummary({ days: 0, fees: "free" })).toBe("Returns are not accepted.");
    expect(returnsSummary({ days: 30, fees: "free" })).toContain("free return shipping");
  });
});

describe("pageMarkdown", () => {
  it("keeps text-bearing blocks in order", () => {
    const md = pageMarkdown({
      title: "About us",
      url: "https://s.example/about",
      shopName: "Example",
      blocks: [
        { id: "1", type: "HERO", data: { title: "Since 1990", subtitle: "Militaria dealer", imageKey: null, cta: null } },
        { id: "2", type: "TEXT", data: { title: "Who we are", markdown: "We **buy** and sell.", cta: null } },
        { id: "3", type: "QUOTE", data: { quote: "Great shop", author: "A. Buyer" } },
        { id: "4", type: "GALLERY", data: { title: null, imageKeys: [] } },
      ] as never,
    });
    expect(md).toBe("# About us\n\nSource: https://s.example/about (Example)\n\n## Since 1990\n\nMilitaria dealer\n\n## Who we are\n\nWe **buy** and sell.\n\n> Great shop\n> — A. Buyer\n");
  });
});

describe("pageMarkdown FAQ", () => {
  it("renders questions as headings with their answers", () => {
    const blocks = (title: string) =>
      [{ id: "f", type: "FAQ", data: { title, items: [{ question: "Do you ship?", answer: "Yes, **worldwide**." }, { question: "Returns?", answer: "14 days." }] } }] as never;
    const titled = pageMarkdown({ title: "Help", url: "https://s.example/help", shopName: "Example", blocks: blocks("Questions") });
    expect(titled).toContain("## Questions\n\n### Do you ship?\n\nYes, **worldwide**.\n\n### Returns?\n\n14 days.\n");
    const untitled = pageMarkdown({ title: "FAQ", url: "https://s.example/faq", shopName: "Example", blocks: blocks("") });
    expect(untitled).toContain("## Do you ship?\n\nYes, **worldwide**.\n\n## Returns?");
  });
});
