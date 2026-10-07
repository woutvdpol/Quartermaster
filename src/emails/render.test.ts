import { createElement } from "react";
import { render, toPlainText } from "@react-email/render";
import { describe, expect, it } from "vitest";
import PasswordReset from "./PasswordReset";
import OrderConfirmationCustomer from "./OrderConfirmationCustomer";
import OrderConfirmationOwner, { orderConfirmationOwnerSubject } from "./OrderConfirmationOwner";
import NewsletterConfirm from "./NewsletterConfirm";
import NewsletterCampaign from "./NewsletterCampaign";
import { formatMoney, type MailBrand, type OrderMailData } from "./types";

const brand: MailBrand = {
  name: "Concept <Militaria>",
  baseUrl: "https://shop.test",
  logoUrl: null,
  colors: { primary: "#3f4a2c", secondary: "#c2b280", accent: "#8b1e1e" },
  contactEmail: "info@shop.test",
  address: "Main 1, 1234 AB Utrecht, NL",
};

const order: OrderMailData = {
  number: 10042,
  placedAt: new Date("2026-10-07T10:00:00Z"),
  currency: "EUR",
  customerName: "Jan de Vries",
  email: "jan@example.com",
  phone: null,
  lines: [
    { title: "M35 helmet", stockCode: 50001, quantity: 1, unitPrice: 45000, lineTotal: 45000 },
    { title: "Belt buckle", stockCode: null, quantity: 2, unitPrice: 2500, lineTotal: 5000 },
  ],
  subtotal: 50000,
  shippingTotal: 1495,
  surchargeTotal: 0,
  total: 51495,
  paymentStatus: "PAID",
  paymentMethod: "ideal",
  shippingMethod: "SHIP",
  shippingZoneName: "Netherlands",
  shippingAddress: { name: "Jan de Vries", company: null, lines: ["Dorpsstraat 1", "1234 AB Utrecht", "Netherlands"] },
  billingAddress: null,
  customerNote: "Please pack well",
  statusUrl: "https://shop.test/order/abc",
};

async function both(el: ReturnType<typeof createElement>) {
  const html = await render(el);
  return { html, text: toPlainText(html) };
}

describe("mail templates render", () => {
  it("PasswordReset", async () => {
    const { html, text } = await both(createElement(PasswordReset, { brand, resetUrl: "https://shop.test/r?token=abc", expiresInMinutes: 30 }));
    expect(html).toContain('href="https://shop.test/r?token=abc"');
    expect(html).toContain("Concept &lt;Militaria&gt;"); // escaped brand name
    expect(text).toContain("30 minutes");
  });

  it("OrderConfirmationCustomer + Owner", async () => {
    const c = await both(createElement(OrderConfirmationCustomer, { brand, order, message: "Thanks!\nSecond line" }));
    expect(c.text).toContain("#10042");
    expect(c.text).toContain(formatMoney(51495, "EUR"));
    expect(c.text).toContain("M35 helmet");
    expect(c.html).toContain("Dorpsstraat 1");
    const o = await both(createElement(OrderConfirmationOwner, { brand, order, adminUrl: "https://shop.test/admin/orders/o1" }));
    expect(o.html).toContain("https://shop.test/admin/orders/o1");
    expect(o.text).toContain("jan@example.com");
    expect(orderConfirmationOwnerSubject(order)).toBe(`New order #10042 — ${formatMoney(51495, "EUR")} from Jan de Vries`);
  });

  it("NewsletterConfirm", async () => {
    const { html } = await both(createElement(NewsletterConfirm, { brand, confirmUrl: "https://shop.test/api/newsletter/confirm?token=t", expiresInDays: 7 }));
    expect(html).toContain("https://shop.test/api/newsletter/confirm?token=t");
  });

  it("NewsletterCampaign includes the body and the unsubscribe link", async () => {
    const { html, text } = await both(
      createElement(NewsletterCampaign, {
        brand: { ...brand, logoUrl: "https://shop.test/uploads/logo.png" },
        subject: "New stock",
        bodyHtml: "<p>Fresh <strong>items</strong></p>",
        unsubscribeUrl: "https://shop.test/api/newsletter/unsubscribe?t=1&s=2&sig=3",
      }),
    );
    expect(html).toContain("<strong>items</strong>");
    expect(html).toContain("https://shop.test/uploads/logo.png");
    expect(html).toContain("unsubscribe?t=1&amp;s=2&amp;sig=3");
    expect(text).toMatch(/Unsubscribe/);
  });
});
