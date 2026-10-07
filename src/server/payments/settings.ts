// Pure helpers for the per-tenant "payments" Setting row (no server-only, no DB) — unit-testable.
// The row holds the Mollie configuration and the payment-method surcharges.
//
// Storage decision: Mollie credentials live in a dedicated `Setting` row with group "payments"
// (unique per tenant). The group is deliberately NOT part of SETTINGS_SCHEMAS (src/server/settings),
// so the generic settings UI/service never reads, returns or overwrites it, and getSettings() can't
// leak the secret to the storefront. Only src/server/payments reads/writes this row.
// The API key is stored AES-256-GCM encrypted (src/server/auth/encryption.ts); plaintext never
// leaves the server and is never logged or audited.
import { z } from "zod";
import { surchargeRulesSchema } from "./surcharge";

export const PAYMENTS_SETTINGS_GROUP = "payments";

export type MollieMode = "test" | "live";

export const paymentsSettingsSchema = z.object({
  mollie: z
    .object({
      /** encrypt(apiKey) — v1.<iv>.<tag>.<ciphertext>. */
      apiKeyEncrypted: z.string().min(1).nullable().default(null),
      mode: z.enum(["test", "live"]).nullable().default(null),
      /** Last 4 characters of the key, for the masked display. */
      keyHint: z.string().max(8).nullable().default(null),
      /** ISO timestamp of the last successful verification against Mollie. */
      verifiedAt: z.string().nullable().default(null),
      /** Mollie method ids offered in checkout; [] = every method enabled in the Mollie dashboard. */
      enabledMethods: z.array(z.string().min(1).max(40)).max(50).default([]),
    })
    .prefault({}),
  /**
   * Payment-method surcharges (./surcharge.ts), keyed by Mollie method id. Not secret, but the storefront
   * reads them only through mollie-config.getSurchargeRules (never the whole row). An invalid value
   * falls back to "no surcharges" without invalidating the Mollie configuration next to it.
   */
  surcharges: surchargeRulesSchema.default({}).catch({}),
});

export type PaymentsSettings = z.output<typeof paymentsSettingsSchema>;

/** Lenient parse of the stored row: anything invalid falls back to "not configured". */
export function parseStoredPaymentsSettings(data: unknown): PaymentsSettings {
  const res = paymentsSettingsSchema.safeParse(data ?? {});
  return res.success ? res.data : paymentsSettingsSchema.parse({});
}

// Mollie API keys: "test_" or "live_" followed by 30 alphanumerics (we accept ≥ 30 to be future-proof).
const MOLLIE_KEY_RE = /^(test|live)_[A-Za-z0-9]{30,64}$/;

export function isValidMollieKeyFormat(key: string): boolean {
  return MOLLIE_KEY_RE.test(key);
}

export function mollieModeFromKey(key: string): MollieMode | null {
  const m = MOLLIE_KEY_RE.exec(key);
  return m ? (m[1] as MollieMode) : null;
}

/** "live_••••••••wxyz" — never more than the last 4 characters. */
export function maskMollieKey(mode: MollieMode | null, hint: string | null): string | null {
  if (!mode || !hint) return null;
  return `${mode}_${"•".repeat(8)}${hint}`;
}

/** Minor units → Mollie amount string with the currency's decimals ("12.34", JPY "1234"). */
export function toMollieAmount(minor: number, currency: string): { currency: string; value: string } {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError("amount must be a non-negative integer (minor units)");
  const code = currency.toUpperCase();
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  if (digits === 0) return { currency: code, value: String(minor) };
  const s = String(minor).padStart(digits + 1, "0");
  return { currency: code, value: `${s.slice(0, -digits)}.${s.slice(-digits)}` };
}
