import "server-only";
import { getMollieCredentials, getSurchargeRules, mollieClient } from "@/server/payments/mollie-config";
import { methodLabel } from "@/server/payments/method-labels";
import { isActiveRule, type SurchargeRule } from "@/server/payments/surcharge";

/*
 * Which payment methods checkout offers (decision 16: Mollie only).
 *  - Owner restricted the list (payments settings `enabledMethods`) → exactly those.
 *  - Otherwise → the methods active on the Mollie account (methods.list, cached 10 min per tenant).
 *    If Mollie can't be reached we offer no list and let the customer pick on Mollie's hosted page.
 *  - Each method carries its surcharge rule (payments settings `surcharges`) for display.
 *  - No Mollie key → `configured: false`. In development (NODE_ENV !== "production") the order page then
 *    offers a "Simulate payment (dev)" button instead; in production checkout is blocked.
 */

export { METHOD_LABELS, methodLabel } from "@/server/payments/method-labels";

export type PaymentMethodOption = {
  id: string;
  label: string;
  /** Surcharge rule for this method (shown next to it; the amount itself always comes from the server quote). */
  surcharge: SurchargeRule | null;
};

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
  const rules = await getSurchargeRules(tenantId);
  return {
    configured: true,
    mode: creds.mode,
    methods: ids.map((id) => ({ id, label: methodLabel(id), surcharge: isActiveRule(rules[id]) ? rules[id] : null })),
    devSimulation: false,
  };
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
