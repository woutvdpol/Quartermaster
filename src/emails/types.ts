// Plain data the mail templates render. No server imports: templates stay pure and previewable.

export type MailBrand = {
  /** Shop name (mail.fromName → general.shopName → tenant name), or "Quartermaster" for platform mail. */
  name: string;
  /** Absolute URL of the shop (no trailing slash), e.g. "https://concept-militaria.nl". */
  baseUrl: string;
  /** Absolute logo URL, or null to show the name as text. */
  logoUrl: string | null;
  colors: { primary: string; secondary: string; accent: string };
  contactEmail: string | null;
  /** One-line postal address for the footer, or "". */
  address: string;
};

export type OrderMailLine = {
  title: string;
  stockCode: number | null;
  quantity: number;
  unitPrice: number; // minor units
  lineTotal: number; // minor units
};

export type OrderMailAddress = {
  name: string;
  company: string | null;
  lines: string[]; // street + number, line2, "postal city", country
};

/** Everything the order confirmation templates show. Amounts are in minor units of `currency`. */
export type OrderMailData = {
  number: number;
  placedAt: Date;
  currency: string;
  customerName: string;
  email: string;
  phone: string | null;
  lines: OrderMailLine[];
  subtotal: number;
  shippingTotal: number;
  surchargeTotal: number;
  total: number;
  paymentStatus: string;
  paymentMethod: string | null;
  shippingMethod: "SHIP" | "PICKUP";
  shippingZoneName: string | null;
  shippingAddress: OrderMailAddress | null;
  billingAddress: OrderMailAddress | null;
  customerNote: string | null;
  /** Public order status page, or null. */
  statusUrl: string | null;
};

export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

export function formatDate(date: Date, timeZone = "Europe/Amsterdam"): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone }).format(date);
}
