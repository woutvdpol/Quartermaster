// Payment-method surcharges (pure: no server-only, no DB) — unit-testable, shared by checkout, the admin
// payments page and the ETL.
//
// Owner request ("PayPal toeslag in de admin"): Concept500 had a surcharge % per payment method (PayPal 5%).
// Here a rule per Mollie method id is: a percentage (basis points, 0–20%) and/or a fixed amount (minor
// units), an optional cap, and the label customers see ("PayPal fee").
//
// Calculation (computeSurcharge):
//  - base = subtotal − coupon discount + shippingTotal (shipping incl. insurance) — i.e. everything the
//    customer pays before the surcharge. This matches Concept500, which applied the % to
//    "products + delivery" (app/Livewire/Steps/ConfirmationStepComponent.php).
//  - percentage part = base × bps / 10 000, rounded HALF UP to whole minor units (exact integer math).
//    Concept500 rounded UP (ceil, Brick RoundingMode::UP); the difference is at most 1 cent and half-up
//    is the usual rule for amounts on invoices.
//  - + fixed amount; then capped at `cap` when set. Never negative; 0 when the base is 0 or less.
//  - The surcharge is not itself part of any later base (no fee on the fee).
import { z } from "zod";

/** 20% — the maximum the admin accepts. */
export const MAX_SURCHARGE_BPS = 2000;
/** Upper bound for fixed amounts and caps (minor units), a sanity limit only. */
export const MAX_SURCHARGE_FIXED = 100_000;

export const surchargeMethodIdSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,40}$/, "Unknown payment method");

export const surchargeRuleSchema = z.object({
  /** Percentage in basis points: 500 = 5%. */
  percentBps: z.number().int().min(0).max(MAX_SURCHARGE_BPS).default(0),
  /** Fixed amount in minor units of the shop currency. */
  fixed: z.number().int().min(0).max(MAX_SURCHARGE_FIXED).default(0),
  /** Maximum surcharge in minor units; null = no cap. */
  cap: z.number().int().min(0).max(MAX_SURCHARGE_FIXED * 10).nullable().default(null),
  /** Shown to customers on the checkout, order page, email and invoice ("PayPal fee"). */
  label: z.string().trim().min(1).max(60),
});
export type SurchargeRule = z.output<typeof surchargeRuleSchema>;

/** method id → rule. Methods without a rule (or with 0% and no fixed amount) cost nothing extra. */
export const surchargeRulesSchema = z
  .record(surchargeMethodIdSchema, surchargeRuleSchema)
  .refine((r) => Object.keys(r).length <= 50, "Too many surcharge rules");
export type SurchargeRules = Record<string, SurchargeRule>;

/** True when the rule can produce a non-zero surcharge. */
export function isActiveRule(rule: SurchargeRule | null | undefined): rule is SurchargeRule {
  return !!rule && (rule.percentBps > 0 || rule.fixed > 0) && rule.cap !== 0;
}

/** The base the percentage applies to: subtotal − discount + shipping (incl. insurance). */
export function surchargeBase(t: { subtotal: number; discount: number; shippingTotal: number }): number {
  return t.subtotal - t.discount + t.shippingTotal;
}

/** Surcharge in minor units for `base` (see the header for the rounding rule). */
export function computeSurcharge(rule: SurchargeRule | null | undefined, base: number): number {
  if (!isActiveRule(rule) || !Number.isSafeInteger(base) || base <= 0) return 0;
  // Integer half-up: floor((base·bps + 5000) / 10000). base·bps stays far below 2^53 for any real order.
  const pct = Math.floor((base * rule.percentBps + 5000) / 10000);
  const amount = pct + rule.fixed;
  return Math.max(0, rule.cap === null ? amount : Math.min(amount, rule.cap));
}

/** What is stored on the order (Order.surchargeDetail) and in the "created" event. */
export type SurchargeSnapshot = {
  method: string;
  label: string;
  percentBps: number;
  fixed: number;
  cap: number | null;
  base: number;
  amount: number;
  rounding: "half-up";
};

export type SurchargedTotals<T> = T & {
  /** Payment-method surcharge (stored as Order.surchargeTotal); already included in `total`. */
  surcharge: number;
  surchargeLabel: string | null;
  surchargeSnapshot: SurchargeSnapshot | null;
};

/**
 * Adds the surcharge of `method` to totals that already contain the coupon discount:
 * total = subtotal − discount + shippingTotal + surcharge.
 */
export function applySurcharge<T extends { subtotal: number; discount: number; shippingTotal: number; total: number }>(
  totals: T,
  method: string | null | undefined,
  rules: SurchargeRules,
): SurchargedTotals<T> {
  const rule = method ? rules[method] : undefined;
  const base = surchargeBase(totals);
  const amount = computeSurcharge(rule, base);
  if (!method || !rule || amount === 0) return { ...totals, surcharge: 0, surchargeLabel: null, surchargeSnapshot: null };
  return {
    ...totals,
    total: totals.total + amount,
    surcharge: amount,
    surchargeLabel: rule.label,
    surchargeSnapshot: { method, label: rule.label, percentBps: rule.percentBps, fixed: rule.fixed, cap: rule.cap, base, amount, rounding: "half-up" },
  };
}

/** "5%", "2.5% + €0.35", "€0.50", with "max €10.00" when capped. `money` formats minor units. */
export function describeSurchargeRule(rule: SurchargeRule, money: (minor: number) => string): string {
  const parts: string[] = [];
  if (rule.percentBps > 0) parts.push(`${formatBps(rule.percentBps)}%`);
  if (rule.fixed > 0) parts.push(money(rule.fixed));
  let s = parts.join(" + ");
  if (rule.cap !== null && s) s += ` (max ${money(rule.cap)})`;
  return s;
}

/** 500 → "5", 250 → "2.5", 125 → "1.25". */
export function formatBps(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.?0+$/, "");
}

/** "5" / "2,5" / "2.50" / "5%" → basis points; null when invalid or more than 2 decimals. */
export function parsePercentToBps(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim().replace(",", ".");
  if (s === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  return Number(int) * 100 + Number(frac.padEnd(2, "0"));
}

/** The customer-facing label stored on an order, with the generic fallback for older/imported orders. */
export function surchargeLabelFor(order: { surchargeLabel?: string | null }): string {
  return order.surchargeLabel?.trim() || "Payment surcharge";
}
