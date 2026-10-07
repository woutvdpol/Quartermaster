import type { FulfillmentStatus, PaymentStatus } from "@/generated/prisma/enums";

/* Display helpers shared by the order, customer and shipping-board screens. */

const METHOD_LABELS: Record<string, string> = {
  ideal: "iDEAL",
  bancontact: "Bancontact",
  creditcard: "Card",
  paypal: "PayPal",
  applepay: "Apple Pay",
  banktransfer: "Bank transfer",
  bank_transfer: "Bank transfer",
  manual: "Manual",
  cash: "Cash",
  sofort: "SOFORT",
  kbc: "KBC/CBC",
  belfius: "Belfius",
  eps: "EPS",
  giropay: "giropay",
  przelewy24: "Przelewy24",
};

/** "ideal" → "iDEAL", legacy "BANK_TRANSFER" → "Bank transfer"; unknown values are shown as is. */
export function paymentMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  return METHOD_LABELS[method.toLowerCase()] ?? method;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "NL" → "Netherlands". */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export type AddressLike = {
  firstName: string;
  lastName: string;
  company: string | null;
  street: string;
  houseNumber: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string;
  region: string | null;
  countryCode: string;
  phone: string | null;
};

/** Address as display lines (name, company, street, line2, postcode + city, region, country). */
export function addressLines(a: AddressLike): string[] {
  return [
    [a.firstName, a.lastName].filter(Boolean).join(" "),
    a.company,
    [a.street, a.houseNumber].filter(Boolean).join(" "),
    a.line2,
    [a.postalCode, a.city].filter(Boolean).join(" "),
    a.region,
    countryName(a.countryCode),
  ].filter((l): l is string => Boolean(l && l.trim()));
}

export type StepState = "done" | "now" | "todo";
export type OrderStep = { label: string; state: StepState };

/**
 * Status stepper (design A): Placed → Paid → Packing → Shipped → Delivered, derived from the
 * separate payment and fulfillment statuses. `stopped` is set for failed/canceled/expired orders.
 */
export function orderSteps(paymentStatus: PaymentStatus, fulfillmentStatus: FulfillmentStatus) {
  const settled = paymentStatus === "PAID" || paymentStatus === "REFUNDED" || paymentStatus === "PARTIALLY_REFUNDED";
  const stopped = paymentStatus === "FAILED" || paymentStatus === "CANCELED" || paymentStatus === "EXPIRED";
  // Index of the first step that is not done yet.
  let reached = 1; // placed
  if (settled) {
    reached = 2;
    if (fulfillmentStatus === "PACKED") reached = 3;
    if (fulfillmentStatus === "SHIPPED") reached = 4;
    if (fulfillmentStatus === "DELIVERED") reached = 5;
  }
  const labels = ["Placed", "Paid", "Packing", "Shipped", "Delivered"];
  const steps: OrderStep[] = labels.map((label, i) => ({
    label,
    state: i < reached ? "done" : i === reached && !stopped ? "now" : "todo",
  }));
  return { steps, stopped };
}

type EventLike = { type: string; data: unknown };

function dataOf(e: EventLike): Record<string, unknown> {
  return e.data && typeof e.data === "object" && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : {};
}

const STATUS_WORD: Record<string, string> = {
  pending: "Payment pending",
  paid: "Payment received",
  failed: "Payment failed",
  canceled: "Payment canceled",
  expired: "Payment expired",
};

/** Human title + optional detail for an OrderEvent (timeline). */
export function describeEvent(e: EventLike): {
  title: string;
  detail?: string;
  tone?: "ok" | "warn" | "crit" | "info";
  highlight?: boolean;
} {
  const d = dataOf(e);
  const str = (k: string) => (typeof d[k] === "string" && d[k] ? (d[k] as string) : null);
  if (e.type.startsWith("payment.")) {
    const status = e.type.slice("payment.".length);
    const provider = str("provider");
    const via = provider === "MANUAL" ? "marked as paid by staff" : provider === "MOLLIE" ? "via Mollie" : null;
    const detail = [via, str("paymentId"), str("note") && `“${str("note")}”`].filter(Boolean).join(" · ");
    return {
      title: STATUS_WORD[status] ?? `Payment ${status}`,
      detail: detail || undefined,
      tone: status === "paid" ? "ok" : status === "failed" ? "crit" : undefined,
      highlight: status === "paid",
    };
  }
  if (e.type.startsWith("fulfillment.")) {
    const status = e.type.slice("fulfillment.".length);
    const words: Record<string, string> = {
      packed: "Marked as packed",
      shipped: "Marked as shipped",
      delivered: "Marked as delivered",
      unfulfilled: "Fulfillment reset",
    };
    const detail = [str("carrier"), str("trackingNumber")].filter(Boolean).join(" · ");
    return {
      title: words[status] ?? `Fulfillment: ${status}`,
      detail: detail || undefined,
      highlight: status === "shipped",
    };
  }
  switch (e.type) {
    case "finalized":
      return {
        title: "Stock booked out, reservations converted",
        detail: str("source") === "manual" ? "after manual payment" : undefined,
      };
    case "confirmation_queued":
      return { title: "Order confirmation queued" };
    case "shipped_mail_queued":
      return { title: "“Shipped” mail queued" };
    case "invoice.issued": {
      const source = str("source") === "manual" ? "by staff" : str("source") === "finalized" ? "automatically after payment" : null;
      const detail = [typeof d.number === "number" ? `no. ${d.number}` : null, source].filter(Boolean).join(" · ");
      return { title: "Invoice issued", detail: detail || undefined, tone: "ok" };
    }
    case "stock.oversold": {
      const lines = Array.isArray(d.lines) ? d.lines.length : 0;
      return {
        title: "Oversold: less stock than ordered",
        detail: lines ? `${lines} ${lines === 1 ? "line needs" : "lines need"} follow-up` : undefined,
        tone: "crit",
      };
    }
    case "reservations.released":
      return {
        title: "Reservations released",
        detail: typeof d.count === "number" ? `${d.count} item(s)` : undefined,
      };
    case "canceled":
      return {
        title: "Order canceled",
        detail: str("reason") ? `“${str("reason")}”` : undefined,
        tone: "warn",
      };
    case "archived":
      return { title: "Archived" };
    case "unarchived":
      return { title: "Restored from archive" };
    case "note":
      return {
        title: "Note",
        detail: str("note") ?? undefined,
        highlight: true,
      };
    case "customer.anonymized":
      return { title: "Customer data anonymized" };
    case "placed":
    case "created":
      return { title: "Order placed" };
    default:
      return { title: e.type };
  }
}
