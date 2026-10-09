import { describe, expect, it } from "vitest";
import { LLMS_FULL_MAX, llmsFullTxt, llmsTxt, platformLlmsTxt, type LlmsInput } from "./llms";

const input: LlmsInput = {
  shop: { name: "Example Militaria", origin: "https://s.example", description: null, currency: "EUR", country: "NL", city: "Utrecht", email: "info@s.example", phone: "" },
  hasArchive: true,
  hasProvenance: true,
  policies: [{ title: "Returns", href: "/returns" }],
  categories: [
    { title: "Helmets", href: "/shop/category/helmets", count: 12, description: "Steel helmets.", children: [{ title: "German", href: "/shop/category/german", count: 1 }] },
  ],
  facets: [{ name: "Period", values: [{ title: "WW2", href: "/shop/facet/period/ww2" }] }],
  latest: [{ title: "M35 helmet", href: "/product/1/m35", stockCode: 1, price: 45000 }],
  returnsLine: "Returns accepted within 14 days of delivery; return shipping paid by the buyer.",
};

describe("llms.txt", () => {
  it("follows the llmstxt.org shape: H1, blockquote summary, link sections, Optional", () => {
    const txt = llmsTxt(input);
    const lines = txt.split("\n");
    expect(lines[0]).toBe("# Example Militaria");
    expect(lines[2]).toMatch(/^> Example Militaria is an online shop/);
    expect(txt).toContain("Based in Utrecht, Netherlands. Prices are in EUR. Contact: info@s.example.");
    expect(txt).toContain("- [All items for sale](https://s.example/shop)");
    expect(txt).toContain("- [Sold archive](https://s.example/archive)");
    expect(txt).toContain("Sold items stay visible in the sold archive (https://s.example/archive) as a reference");
    expect(txt).toContain("https://s.example/feeds/google-merchant.xml");
    expect(txt).toContain("- [Helmets](https://s.example/shop/category/helmets): 12 items for sale");
    expect(txt).not.toContain("German"); // short version: top level only
    expect(txt).toContain("https://s.example/verify");
    expect(txt).toContain("https://s.example/product/123.md");
    expect(txt).toContain("## Optional");
    expect(txt.endsWith("\n")).toBe(true);
  });

  it("only links to the shop's own origin", () => {
    for (const url of llmsFullTxt(input).match(/https?:\/\/[^\s)]+/g) ?? []) expect(url.startsWith("https://s.example/")).toBe(true);
  });

  it("full version adds subcategories, descriptions, facets and latest items", () => {
    const txt = llmsFullTxt(input);
    expect(txt).toContain("  - [German](https://s.example/shop/category/german): 1 item for sale");
    expect(txt).toContain("12 items for sale — Steel helmets.");
    expect(txt).toContain("## Browse by period");
    expect(txt).toContain("- [M35 helmet](https://s.example/product/1/m35): No. 1, €450.00");
  });

  it("stays under the size cap", () => {
    const many = { ...input, latest: Array.from({ length: 5000 }, (_, i) => ({ title: `Item ${i} ${"x".repeat(40)}`, href: `/product/${i}/x`, stockCode: i, price: 100 })) };
    const txt = llmsFullTxt(many);
    expect(txt.length).toBeLessThanOrEqual(LLMS_FULL_MAX);
    expect(txt).toContain("(List truncated.)");
  });

  it("has a platform variant that points to the shops", () => {
    expect(platformLlmsTxt("https://platform.example")).toContain("- [Apply for a shop](https://platform.example/apply)");
  });
});
