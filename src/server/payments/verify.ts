// Pure verification of a fetched Mollie payment against our own records (no server-only, no DB) —
// unit-testable. Security review R3: before a Mollie status is applied to an order, the payment Mollie
// returns must be the one we created for exactly this order, amount and API mode.
import { toMollieAmount, type MollieMode } from "./settings";

export type MismatchReason = "ID" | "AMOUNT" | "CURRENCY" | "MODE" | "TENANT" | "ORDER";

export type FetchedMolliePayment = {
  id: string;
  mode?: string | null;
  amount?: { value?: string | null; currency?: string | null } | null;
  metadata?: unknown;
};

export type ExpectedMolliePayment = {
  providerPaymentId: string;
  /** Payment.amount / Payment.currency (minor units) — what we asked Mollie to charge. */
  amount: number;
  currency: string;
  /** Order.total / Order.currency — must equal the attempt amount as well. */
  orderTotal: number;
  orderCurrency: string;
  /** Mode of the tenant's configured API key. */
  mode: MollieMode;
  tenantId: string;
  orderId: string;
};

export type Mismatch = { reason: MismatchReason; expected: string; actual: string };

/** Normalises "10.5" / "10.50" to the canonical 2-decimal string Mollie uses ("10.50"). */
function canonicalValue(value: string | null | undefined, currency: string): string | null {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) return null;
  const expected = toMollieAmount(0, currency).value; // "0.00" or "0"
  const digits = expected.includes(".") ? expected.split(".")[1].length : 0;
  const [int, frac = ""] = value.split(".");
  if (frac.length > digits && /[^0]/.test(frac.slice(digits))) return null; // more precision than the currency has
  const f = frac.slice(0, digits).padEnd(digits, "0");
  return digits ? `${String(Number(int))}.${f}` : String(Number(int));
}

/**
 * Every way the fetched payment differs from what we created. Empty array = it is ours and correct.
 *  - id: Mollie returned the payment we asked for (and it is the one on our Payment row);
 *  - amount + currency equal BOTH the Payment row and the order total (toMollieAmount on minor units);
 *  - mode (test/live) equals the mode of the tenant's API key (a test payment never pays a live order);
 *  - metadata.tenantId / metadata.orderId (set by createMolliePayment) point at this tenant and order.
 */
export function verifyMolliePayment(mp: FetchedMolliePayment, expected: ExpectedMolliePayment): Mismatch[] {
  const out: Mismatch[] = [];
  if (mp.id !== expected.providerPaymentId) out.push({ reason: "ID", expected: expected.providerPaymentId, actual: String(mp.id) });

  const want = toMollieAmount(expected.amount, expected.currency);
  const order = toMollieAmount(expected.orderTotal, expected.orderCurrency);
  const actualCurrency = String(mp.amount?.currency ?? "").toUpperCase();
  const actualValue = canonicalValue(mp.amount?.value ?? null, want.currency);
  if (actualCurrency !== want.currency || want.currency !== order.currency) {
    out.push({ reason: "CURRENCY", expected: want.currency, actual: actualCurrency || "?" });
  }
  if (actualValue !== want.value || want.value !== order.value) {
    out.push({ reason: "AMOUNT", expected: `${want.value} (order ${order.value})`, actual: actualValue ?? String(mp.amount?.value ?? "?") });
  }

  if (mp.mode !== expected.mode) out.push({ reason: "MODE", expected: expected.mode, actual: String(mp.mode ?? "?") });

  const meta = (mp.metadata && typeof mp.metadata === "object" ? mp.metadata : {}) as Record<string, unknown>;
  if (meta.tenantId !== expected.tenantId) out.push({ reason: "TENANT", expected: expected.tenantId, actual: typeof meta.tenantId === "string" ? meta.tenantId : "?" });
  if (meta.orderId !== expected.orderId) out.push({ reason: "ORDER", expected: expected.orderId, actual: typeof meta.orderId === "string" ? meta.orderId : "?" });
  return out;
}
