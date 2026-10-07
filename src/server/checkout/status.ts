// Pure: what the customer-facing order page shows for an order + its latest Mollie attempt.

/**
 * paid       — payment received (finalization happens in the webhook transaction)
 * refunded   — (partially) refunded
 * canceled   — canceled by the shop
 * failed     — last payment failed / was canceled at Mollie / expired → retry may be offered
 * unpaid     — order exists but no payment is running (start failed, retry reset, dev without Mollie)
 * waiting    — a Mollie payment is open (customer may still be paying, or webhook not in yet)
 * processing — Mollie reports pending/authorized (e.g. bank transfer, card review)
 */
export type OrderDisplayState = "paid" | "refunded" | "canceled" | "failed" | "unpaid" | "waiting" | "processing";

export function orderDisplayState(
  order: { paymentStatus: string; canceledAt: Date | null },
  latestAttempt: { status: string } | null,
): OrderDisplayState {
  switch (order.paymentStatus) {
    case "PAID":
      return "paid";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "refunded";
  }
  if (order.canceledAt) return "canceled";
  if (order.paymentStatus === "FAILED" || order.paymentStatus === "EXPIRED" || order.paymentStatus === "CANCELED") return "failed";
  switch (latestAttempt?.status) {
    case "OPEN":
      return "waiting";
    case "PENDING":
    case "AUTHORIZED":
    case "PAID":
      return "processing";
    default:
      return "unpaid";
  }
}

/** States in which the order page keeps polling the database for a change. */
export function shouldPoll(state: OrderDisplayState): boolean {
  return state === "waiting" || state === "processing";
}
