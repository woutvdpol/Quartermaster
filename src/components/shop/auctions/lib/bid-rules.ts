import { DEFAULT_INCREMENT_TABLE, incrementFor, type IncrementTable } from "@/server/auctions/increments";
import type { LiveLot } from "./types";

/*
 * Bid-box arithmetic (pure). The engine is the authority; its pure increment table
 * (src/server/auctions/increments.ts) is shared here to offer quick-bid amounts, and this decides when
 * to ask "are you sure?". The server rejects anything below its own minimum (BELOW_MINIMUM).
 */

/** Step that applies above `amount` (engine's table semantics; empty table → the shop default). */
export function stepFor(amount: number, table: IncrementTable = DEFAULT_INCREMENT_TABLE): number {
  return incrementFor(amount, table.length ? table : DEFAULT_INCREMENT_TABLE);
}

/** Quick-bid amounts: the next minimum and the `count − 1` steps above it. */
export function quickBids(lot: Pick<LiveLot, "nextMinimum">, table?: IncrementTable, count = 3): number[] {
  const out = [lot.nextMinimum];
  while (out.length < count) {
    const prev = out[out.length - 1];
    out.push(prev + stepFor(prev, table));
  }
  return out;
}

/** Bids at or above this need an explicit confirmation (€1,000 in a 2-decimal currency). */
export const CONFIRM_ABOVE_MINOR = 100_000;

/** Ask "You're bidding up to €X — continue?" for large maxima: ≥ €1,000, or ≥ 2× the current price. */
export function needsConfirm(maxAmount: number, lot: Pick<LiveLot, "currentBid" | "startPrice">, threshold = CONFIRM_ABOVE_MINOR): boolean {
  const current = lot.currentBid ?? lot.startPrice;
  return maxAmount >= threshold || (current > 0 && maxAmount >= current * 2);
}

/** The price a visitor sees: the current bid, or the start price before the first bid. */
export function displayPrice(lot: Pick<LiveLot, "currentBid" | "startPrice">): number {
  return lot.currentBid ?? lot.startPrice;
}
