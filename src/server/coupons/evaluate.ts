// Pure coupon rules (no server-only, no DB) — unit-testable. All amounts are integer minor units.
//
// Rules (docs/etl/commerce.md has the owner-facing summary):
//  - PERCENT: value = basis points (1000 = 10 %) of the ELIGIBLE subtotal, rounded half-up to the cent.
//  - FIXED: value off the eligible subtotal.
//  - FREE_SHIPPING: the chosen shipping option's price becomes 0 (insurance is not shipping and stays).
//  - The discount never exceeds the eligible subtotal; the eligible subtotal never exceeds the subtotal,
//    so Order.discountTotal ≤ Order.subtotal always holds (also enforced by a DB check constraint).
//  - Eligible subtotal = lines at their normal price. Lines bought at an agreed offer price are
//    excluded: a coupon never stacks on a negotiated price. minSubtotal is checked against it too.

export type CouponType = "PERCENT" | "FIXED" | "FREE_SHIPPING";

export type CouponRule = {
  code: string;
  type: CouponType;
  value: number;
  minSubtotal: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  perEmailLimit: number | null;
  isActive: boolean;
};

export type CouponUsage = {
  /** Redemptions that count against maxRedemptions (see countUsage in ./index.ts). */
  total: number;
  /** Same, for this email (null when the email is not known yet — the check is then skipped). */
  byEmail: number | null;
};

export type CouponRefusal =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "MIN_SUBTOTAL"
  | "MAX_REDEMPTIONS"
  | "PER_EMAIL_LIMIT"
  | "NOT_APPLICABLE";

export type CouponOutcome =
  | {
      ok: true;
      code: string;
      type: CouponType;
      /** Off the subtotal (0 for FREE_SHIPPING). */
      discount: number;
      /** Shipping price waived (FREE_SHIPPING only). */
      shippingDiscount: number;
      freeShipping: boolean;
    }
  | { ok: false; code: string; reason: CouponRefusal; message: string };

/** Canonical form of a code as stored (upper-case, trimmed). */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

/** basis points × amount / 10 000, rounded half-up (amount ≥ 0). */
export function percentOf(amount: number, basisPoints: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("amount must be a non-negative integer");
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) throw new RangeError("basisPoints must be a non-negative integer");
  return Math.floor((amount * basisPoints + 5000) / 10000);
}

export function refusalMessage(reason: CouponRefusal, coupon?: Pick<CouponRule, "minSubtotal">, formatMoney?: (n: number) => string): string {
  switch (reason) {
    case "NOT_FOUND":
      return "This code is not valid";
    case "INACTIVE":
      return "This code is no longer active";
    case "NOT_STARTED":
      return "This code is not valid yet";
    case "EXPIRED":
      return "This code has expired";
    case "MIN_SUBTOTAL":
      return coupon && formatMoney
        ? `This code needs a subtotal of at least ${formatMoney(coupon.minSubtotal)}`
        : "Your subtotal is too low for this code";
    case "MAX_REDEMPTIONS":
      return "This code has been fully used";
    case "PER_EMAIL_LIMIT":
      return "You have already used this code";
    case "NOT_APPLICABLE":
      return "This code doesn't apply to the items in your cart";
  }
}

/**
 * Evaluates a coupon for an eligible subtotal and the chosen shipping price.
 * `coupon` null → NOT_FOUND. Never throws for business refusals.
 */
export function evaluateCouponRule(
  coupon: CouponRule | null,
  input: { code: string; eligibleSubtotal: number; shippingPrice: number; usage: CouponUsage; now?: Date },
  formatMoney?: (n: number) => string,
): CouponOutcome {
  const code = normalizeCouponCode(input.code);
  const refuse = (reason: CouponRefusal): CouponOutcome => ({ ok: false, code, reason, message: refusalMessage(reason, coupon ?? undefined, formatMoney) });
  if (!coupon) return refuse("NOT_FOUND");
  const now = input.now ?? new Date();
  const base = input.eligibleSubtotal;
  if (!Number.isSafeInteger(base) || base < 0) throw new RangeError("eligibleSubtotal must be a non-negative integer");
  if (!Number.isSafeInteger(input.shippingPrice) || input.shippingPrice < 0) throw new RangeError("shippingPrice must be a non-negative integer");

  if (!coupon.isActive) return refuse("INACTIVE");
  if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) return refuse("NOT_STARTED");
  if (coupon.endsAt && now.getTime() >= coupon.endsAt.getTime()) return refuse("EXPIRED");
  if (coupon.maxRedemptions !== null && input.usage.total >= coupon.maxRedemptions) return refuse("MAX_REDEMPTIONS");
  if (coupon.perEmailLimit !== null && input.usage.byEmail !== null && input.usage.byEmail >= coupon.perEmailLimit) return refuse("PER_EMAIL_LIMIT");
  if (base <= 0) return refuse("NOT_APPLICABLE");
  if (base < coupon.minSubtotal) return refuse("MIN_SUBTOTAL");

  const ok = (discount: number, shippingDiscount: number): CouponOutcome => ({
    ok: true,
    code: coupon.code,
    type: coupon.type,
    discount: Math.min(Math.max(0, discount), base),
    shippingDiscount,
    freeShipping: coupon.type === "FREE_SHIPPING",
  });
  switch (coupon.type) {
    case "PERCENT":
      return ok(percentOf(base, Math.min(coupon.value, 10000)), 0);
    case "FIXED":
      return ok(coupon.value, 0);
    case "FREE_SHIPPING":
      return ok(0, input.shippingPrice);
  }
}

export type DiscountedTotals<T extends { subtotal: number; shipping: number; insurance: number; shippingTotal: number; total: number }> = T & {
  /** Coupon discount off the subtotal (stored as Order.discountTotal). */
  discount: number;
  /** Shipping waived by a FREE_SHIPPING coupon (already removed from `shipping`). */
  shippingDiscount: number;
};

/** total = subtotal − discount + shipping (+ insurance); shipping is 0 with a free-shipping coupon. */
export function applyCouponToTotals<T extends { subtotal: number; shipping: number; insurance: number; shippingTotal: number; total: number }>(
  totals: T,
  outcome: CouponOutcome | null,
): DiscountedTotals<T> {
  if (!outcome || !outcome.ok) return { ...totals, discount: 0, shippingDiscount: 0 };
  const discount = Math.min(outcome.discount, totals.subtotal);
  const shippingDiscount = outcome.freeShipping ? totals.shipping : 0;
  const shipping = totals.shipping - shippingDiscount;
  const shippingTotal = shipping + totals.insurance;
  return { ...totals, shipping, shippingTotal, total: totals.subtotal - discount + shippingTotal, discount, shippingDiscount };
}
