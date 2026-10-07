import { createElement } from "react";
import { render, toPlainText } from "@react-email/render";
import { describe, expect, it } from "vitest";
import SavedSearchConfirm from "./SavedSearchConfirm";
import NewArrivalsDigest, { newArrivalsSubject } from "./NewArrivalsDigest";
import BackAvailable from "./BackAvailable";
import PriceDrop, { priceDropSubject } from "./PriceDrop";
import type { AlertMailProduct } from "./AlertProduct";
import type { MailBrand } from "./types";

const brand: MailBrand = {
  name: "Concept Militaria",
  baseUrl: "https://shop.test",
  logoUrl: null,
  colors: { primary: "#3f4a2c", secondary: "#c2b280", accent: "#8b1e1e" },
  contactEmail: null,
  address: "",
};
const product: AlertMailProduct = {
  title: "M35 <Helmet>",
  stockCode: 50231,
  url: "https://shop.test/product/50231/m35",
  imageUrl: "https://shop.test/uploads/x.jpg",
  price: 45000,
  currency: "EUR",
  category: "Helmets",
};

describe("alert mails render", () => {
  it("SavedSearchConfirm", async () => {
    const html = await render(createElement(SavedSearchConfirm, { brand, searchName: "Helmets", confirmUrl: "https://shop.test/alerts/confirm?token=t", expiresInDays: 7 }));
    expect(html).toContain("https://shop.test/alerts/confirm?token=t");
    expect(toPlainText(html)).toContain("7 days");
  });

  it("NewArrivalsDigest lists products, escapes titles and links unsubscribe/manage", async () => {
    const html = await render(
      createElement(NewArrivalsDigest, {
        brand,
        searchName: "Helmets",
        frequency: "DAILY",
        products: [product],
        moreCount: 2,
        searchUrl: "https://shop.test/shop/category/helmets",
        unsubscribeUrl: "https://shop.test/alerts/unsubscribe?s=1",
        manageUrl: "https://shop.test/alerts/manage?s=1",
      }),
    );
    expect(html).toContain("M35 &lt;Helmet&gt;");
    expect(html).toContain("alerts/unsubscribe?s=1");
    expect(html).toContain("alerts/manage?s=1");
    expect(toPlainText(html)).toContain("3 new items");
    expect(newArrivalsSubject(brand, "Helmets", [product])).toBe("New at Concept Militaria: M35 <Helmet>");
    expect(newArrivalsSubject(brand, "Helmets", [product], 4)).toContain("5 new items");
  });

  it("BackAvailable + PriceDrop", async () => {
    const b = await render(createElement(BackAvailable, { brand, product, stopUrl: "https://shop.test/stop", wishlistUrl: "https://shop.test/wishlist" }));
    expect(b).toContain("https://shop.test/stop");
    const p = await render(createElement(PriceDrop, { brand, product: { ...product, oldPrice: 50000 }, stopUrl: "https://shop.test/stop", wishlistUrl: "https://shop.test/wishlist" }));
    expect(toPlainText(p)).toContain("€500.00");
    expect(priceDropSubject(product)).toContain("€450.00");
  });
});
