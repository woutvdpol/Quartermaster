import { describe, expect, it } from "vitest";
import { LABEL_LAYOUTS, renderFairLabelsPdf } from "./labels-pdf";

describe("renderFairLabelsPdf", () => {
  const labels = Array.from({ length: 25 }, (_, i) => ({
    stockCode: 50160 + i,
    title: i === 0 ? "Stahlhelm M40 Heer, ET64 — Größe 64 mit sehr langem Titel, der gekürzt werden muss" : `Item ${i}`,
    price: 145000 + i * 50,
    url: `https://shop.example/product/${50160 + i}`,
  }));

  it.each(LABEL_LAYOUTS)("renders the %s layout", async (layout) => {
    const pdf = await renderFairLabelsPdf({ labels, layout, withPrice: true, currency: "EUR", title: "Test fair — labels" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // A4: 25 labels on 2 sheets of 24; single-label layouts: one page each.
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages).toBe(layout === "a4" ? 2 : 25);
  }, 30_000);
});
