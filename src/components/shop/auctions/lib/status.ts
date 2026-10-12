import type { LiveLot } from "./types";

/*
 * What a lot card / lot page says about a lot (pure). The server status is the truth, with two
 * time-based refinements on the server clock: a lot past its closesAt that the closer has not
 * processed yet is "closing" (shown as closed, result pending), and a lot of an auction that has not
 * opened yet is "upcoming".
 */

export type LotChip = "won" | "lead" | "outbid" | "sold" | "unsold" | "cancelled" | "closing" | "upcoming" | "open";

export type ChipTone = "ok" | "warn" | "sold" | "neutral" | "primary";

export const CHIP_TONE: Record<LotChip, ChipTone> = {
  won: "ok",
  lead: "ok",
  outbid: "warn",
  sold: "sold",
  unsold: "neutral",
  cancelled: "neutral",
  closing: "neutral",
  upcoming: "neutral",
  open: "primary",
};

/** The viewer's relation to the lot: their bidder number in this auction and whether they bid on it. */
export type Viewer = { bidderNumber: number | null; hasBid: boolean } | null;

export function lotChip(
  lot: Pick<LiveLot, "status" | "closesAt" | "leaderNumber">,
  viewer: Viewer,
  serverNow: number,
  opensAt?: string | null,
): LotChip {
  const leading = viewer?.bidderNumber != null && lot.leaderNumber === viewer.bidderNumber;
  switch (lot.status) {
    case "CANCELLED":
      return "cancelled";
    case "SOLD":
      return leading ? "won" : "sold";
    case "UNSOLD":
      return "unsold";
  }
  if (Date.parse(lot.closesAt) <= serverNow) return "closing";
  if (opensAt && Date.parse(opensAt) > serverNow) return "upcoming";
  if (leading) return "lead";
  if (viewer?.hasBid) return "outbid";
  return "open";
}

/** Lots that still take bids at `serverNow`. */
export function isBiddable(lot: Pick<LiveLot, "status" | "closesAt">, serverNow: number, opensAt?: string | null): boolean {
  return lot.status === "OPEN" && Date.parse(lot.closesAt) > serverNow && !(opensAt && Date.parse(opensAt) > serverNow);
}
