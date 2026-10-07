import type { PaymentAttemptStatus, PaymentStatus } from "@/generated/prisma/enums";

/*
 * Pure Mollie status mapping (no I/O, unit-testable).
 *
 * Legacy bug fixed here: Concept500 treated every non-"paid" status as "failed", so a customer
 * whose iDEAL/bank payment was still `open`/`pending` saw a failed order. Here open/pending/
 * authorized keep the order PENDING; only failed/canceled/expired are terminal non-paid states.
 */
export const MOLLIE_STATUSES = ["open", "pending", "authorized", "paid", "failed", "canceled", "expired"] as const;
export type MollieStatus = (typeof MOLLIE_STATUSES)[number];

export function isMollieStatus(value: string): value is MollieStatus {
  return (MOLLIE_STATUSES as readonly string[]).includes(value);
}

const ATTEMPT: Record<MollieStatus, PaymentAttemptStatus> = {
  open: "OPEN",
  pending: "PENDING",
  authorized: "AUTHORIZED",
  paid: "PAID",
  failed: "FAILED",
  canceled: "CANCELED",
  expired: "EXPIRED",
};

const ORDER: Record<MollieStatus, PaymentStatus> = {
  open: "PENDING",
  pending: "PENDING",
  authorized: "PENDING",
  paid: "PAID",
  failed: "FAILED",
  canceled: "CANCELED",
  expired: "EXPIRED",
};

/** Payment-attempt status (Payment.status) for a Mollie status. */
export function mollieToAttemptStatus(status: MollieStatus): PaymentAttemptStatus {
  return ATTEMPT[status];
}

/** Order-level payment status (Order.paymentStatus) for a Mollie status. */
export function mollieToOrderStatus(status: MollieStatus): PaymentStatus {
  return ORDER[status];
}

/** True for terminal non-paid outcomes: the order's stock holds must be released. */
export function releasesReservations(status: MollieStatus): boolean {
  return status === "failed" || status === "canceled" || status === "expired";
}

/** Attempt statuses that can no longer change (a later webhook must not downgrade them). */
export function isFinalAttemptStatus(status: PaymentAttemptStatus): boolean {
  return status === "PAID" || status === "FAILED" || status === "CANCELED" || status === "EXPIRED";
}
