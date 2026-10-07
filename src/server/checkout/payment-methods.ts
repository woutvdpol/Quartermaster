import "server-only";
import { getMollieCredentials, mollieClient } from "@/server/payments/mollie-config";

/*
 * Which payment methods checkout offers (decision 16: Mollie only).
 *  - Owner restricted the list (payments settings `enabledMethods`) → exactly those.
 *  - Otherwise → the methods active on the Mollie account (methods.list, cached 10 min per tenant).
 *    If Mollie can't be reached we offer no list and let the customer pick on Mollie's hosted page.
 *  - No Mollie key → `configured: false`. In development (NODE_ENV !== "production") the order page then
 *    offers a "Simulate payment (dev)" button instead; in production checkout is blocked.
 */

export const METHOD_LABELS: Record<string, string> = {
  ideal: "iDEAL",
  bancontact: "Bancontact",
  creditcard: "Credit card",
  paypal: "PayPal",
  applepay: "Apple Pay",
  googlepay: "Google Pay",
  banktransfer: "Bank transfer",
  belfius: "Belfius",
  kbc: "KBC/CBC",
  eps: "EPS",
  giropay: "giropay",
  przelewy24: "Przelewy24",
  sofort: "SOFORT",
  klarna: "Klarna",
  klarnapaylater: "Klarna Pay later",
  klarnapaynow: "Klarna Pay now",
  klarnasliceit: "Klarna Slice it",
  in3: "in3",
  giftcard: "Gift card",
  mybank: "MyBank",
  twint: "TWINT",
  blik: "BLIK",
  trustly: "Trustly",
  riverty: "Riverty",
  billie: "Billie",
  alma: "Alma",
  satispay: "Satispay",
  paybybank: "Pay by Bank",
  bacs: "Bacs Direct Debit",
  swish: "Swish",
  mbway: "MB WAY",
  multibanco: "Multibanco",
};

export function methodLabel(id: string): string {
  return METHOD_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export type PaymentMethodOption = { id: string; label: string };

export type PaymentSetup = {
  configured: boolean;
  mode: "test" | "live" | null;
  /** [] with configured = let Mollie's hosted page offer the choice. */
  methods: PaymentMethodOption[];
  /** Dev-only stand-in for Mollie when no key is configured. */
  devSimulation: boolean;
};

const CACHE_MS = 10 * 60 * 1000;
const methodCache = new Map<string, { at: number; ids: string[] }>();

export function isDevSimulationAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export async function getPaymentSetup(tenantId: string): Promise<PaymentSetup> {
  const creds = await getMollieCredentials(tenantId);
  if (!creds) return { configured: false, mode: null, methods: [], devSimulation: isDevSimulationAllowed() };
  let ids = creds.enabledMethods;
  if (!ids.length) {
    const key = `${tenantId}:${creds.apiKey.slice(-6)}`;
    const hit = methodCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) ids = hit.ids;
    else {
      try {
        const list = await mollieClient(creds.apiKey).methods.list();
        ids = list.map((m) => m.id as string);
        methodCache.set(key, { at: Date.now(), ids });
      } catch (err) {
        console.warn(`[checkout] ${tenantId}: could not list Mollie methods`, err instanceof Error ? err.message : err);
        ids = [];
      }
    }
  }
  return { configured: true, mode: creds.mode, methods: ids.map((id) => ({ id, label: methodLabel(id) })), devSimulation: false };
}

/** The method to store/send, or an error message. "" = Mollie chooses (only when no list is offered). */
export function validatePaymentMethod(setup: PaymentSetup, method: string): { ok: true; method: string | null } | { ok: false; message: string } {
  if (!setup.configured) return { ok: true, method: null };
  // No list offered (Mollie unreachable when rendering): ignore the client value, Mollie's page asks.
  if (!setup.methods.length) return { ok: true, method: null };
  if (!method) return { ok: false, message: "Choose a payment method" };
  if (!setup.methods.some((m) => m.id === method)) return { ok: false, message: "This payment method is not available" };
  return { ok: true, method };
}

/** Test hook. */
export function clearPaymentMethodCache() {
  methodCache.clear();
}
