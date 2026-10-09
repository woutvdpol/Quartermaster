// Fair-mode offline queue: pure logic shared by the phone client and its tests (docs/fair-mode.md).
// Every sale gets a clientRef on the device; the server stores it on the order (unique per tenant),
// so delivering a queued sale twice returns the same order instead of selling twice.

import type { FairPaymentMethod } from "./pure";

export type QueuedSale = {
  clientRef: string;
  fairId: string;
  productId: string;
  stockCode: number;
  title: string;
  price: number;
  method: FairPaymentMethod;
  buyerEmail: string | null;
  allowBelowFloor: boolean;
  /** Device time of the confirmation (ISO). */
  soldAt: string;
  attempts: number;
  /** pending = waiting to sync; rejected = the server refused it (needs attention, never retried). */
  state: "pending" | "rejected";
  error: string | null;
};

/** Adds a sale unless one with the same clientRef is already queued (returns the same array then). */
export function enqueueSale(queue: QueuedSale[], sale: QueuedSale): QueuedSale[] {
  return queue.some((s) => s.clientRef === sale.clientRef) ? queue : [...queue, sale];
}

export type SyncOutcome = "done" | "rejected" | "auth" | "retry";

/**
 * What to do with a queued sale after a sync attempt. `status` 0 = network error (offline).
 *  done      2xx — synced (also a repeated clientRef: the server returns the existing order)
 *  rejected  the server refused the sale (sold meanwhile, not on the fair, below floor) — keep it
 *            visible for the seller, never retry automatically
 *  auth      session expired — stop syncing until the seller signs in again
 *  retry     offline / server error — try again later
 */
export function syncOutcome(status: number, body: { ok?: boolean; code?: string } | null): SyncOutcome {
  if (status >= 200 && status < 300 && body?.ok) return "done";
  if (status === 401 || status === 403) return "auth";
  if (body && body.ok === false && (body.code === "CONFLICT" || body.code === "INVALID" || body.code === "NOT_FOUND")) return "rejected";
  return "retry";
}

/** Backoff between automatic retries: 2s, 4s, 8s … capped at one minute. */
export function retryDelay(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}
