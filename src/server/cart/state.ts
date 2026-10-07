// Pure cart helpers (no server-only, no DB) — unit-testable.

/**
 * held        — this cart holds a live reservation
 * lapsed      — this cart's hold expired but nobody else holds it: can be re-reserved ("re-add")
 * taken       — someone else (another cart or a pending order) holds it right now
 * unavailable — sold, unpublished or out of stock
 */
export type CartLineState = "held" | "lapsed" | "taken" | "unavailable";

export function lineState(
  product: { status: string; quantity: number },
  liveHold: { cartId: string | null; orderId?: string | null; expiresAt: Date } | null,
  cartId: string,
  now: Date = new Date(),
): CartLineState {
  if (product.status !== "ACTIVE" || product.quantity <= 0) return "unavailable";
  if (!liveHold || liveHold.expiresAt.getTime() <= now.getTime()) return "lapsed";
  if (liveHold.cartId === cartId && !liveHold.orderId) return "held";
  return "taken";
}

/** Whole minutes until `until` (at least 1), for "try again in N min". */
export function minutesUntil(until: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
}
