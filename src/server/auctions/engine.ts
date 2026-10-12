// Proxy bidding engine (pure: no server-only, no DB). docs/auctions.md § Hoe bieden werkt.
//
// Standard second-price proxy bidding ("maximumbod"): every bidder submits a maximum; the system bids
// for them in steps of the increment table, only as high as needed to lead.
//
//   no leader            → current = start price, leader = bidder
//   challenger M > L     → current = min(M, L + increment(L)), leader = challenger
//   challenger M ≤ L     → current = min(L, M + increment(M)), leader stays (tie M == L: the earlier
//                          bid wins, current = L)
//   leader raises max    → only leadingMax changes (current unchanged)
//
// Reserve (hidden minimum price): when the leader's maximum reaches the reserve, the visible price
// jumps to the reserve (current = reserve when current < reserve ≤ leadingMax) — otherwise a lot whose only
// bidder is willing to pay the reserve would close "reserve not met" at the start price.
//
// Each submission yields Bid rows for the visible steps, in order: the challenger's own row
// (isAuto = false, maxAmount = the submitted maximum) and the automatic counter-bid (isAuto = true).
// When a challenger beats the leader, the old leader's automatic bid at their maximum is recorded first
// (the price passed through it), then the new leader's row at the new price.

import { incrementFor, nextMinimum, type IncrementTable } from "./increments";

export type LotState = {
  /** Visible price; null = no bids. */
  current: number | null;
  leaderId: string | null;
  /** The leader's maximum (private). */
  leadingMax: number | null;
};

export const EMPTY_LOT_STATE: LotState = Object.freeze({ current: null, leaderId: null, leadingMax: null }) as LotState;

export type EngineConfig = { startPrice: number; reservePrice: number | null; table: IncrementTable };

export type BidStep = { customerId: string; amount: number; maxAmount: number; isAuto: boolean };

export type BidOutcome = {
  state: LotState;
  /** Bid rows to insert, in this order. */
  steps: BidStep[];
  kind: "first" | "new-leader" | "outbid" | "raise";
  /** The leader before this bid when the leader changed (gets the "outbid" notification). */
  displacedLeaderId: string | null;
};

export type BidCheck = { ok: true } | { ok: false; reason: "BELOW_MINIMUM"; minimum: number };

function withReserve(current: number, leadingMax: number, reserve: number | null): number {
  if (reserve === null || current >= reserve || leadingMax < reserve) return current;
  return reserve;
}

/** The lowest maximum `customerId` may submit now (a leader must go above their own maximum). */
export function minimumFor(state: LotState, customerId: string, cfg: EngineConfig): number {
  const min = nextMinimum(state.current, cfg.startPrice, cfg.table);
  if (state.leaderId === customerId && state.leadingMax !== null) return Math.max(min, state.leadingMax + 1);
  return min;
}

export function checkBid(state: LotState, bid: { customerId: string; maxAmount: number }, cfg: EngineConfig): BidCheck {
  const minimum = minimumFor(state, bid.customerId, cfg);
  return Number.isInteger(bid.maxAmount) && bid.maxAmount >= minimum ? { ok: true } : { ok: false, reason: "BELOW_MINIMUM", minimum };
}

/**
 * Applies one submission to the lot. The caller must have validated it with checkBid (an invalid bid
 * throws). Never lowers the visible price.
 */
export function applyBid(state: LotState, bid: { customerId: string; maxAmount: number }, cfg: EngineConfig): BidOutcome {
  const check = checkBid(state, bid, cfg);
  if (!check.ok) throw new Error(`Bid below minimum (${bid.maxAmount} < ${check.minimum})`);
  const M = bid.maxAmount;
  const B = bid.customerId;

  // First bid.
  if (state.leaderId === null || state.leadingMax === null) {
    const current = withReserve(Math.max(cfg.startPrice, state.current ?? 0), M, cfg.reservePrice);
    return {
      state: { current, leaderId: B, leadingMax: M },
      steps: [{ customerId: B, amount: current, maxAmount: M, isAuto: false }],
      kind: "first",
      displacedLeaderId: null,
    };
  }

  const before = state.current ?? cfg.startPrice;
  const L = state.leadingMax;
  const A = state.leaderId;

  // The leader raises their own maximum: only the maximum changes (unless it now reaches the reserve).
  if (A === B) {
    const current = withReserve(before, M, cfg.reservePrice);
    return {
      state: { current, leaderId: A, leadingMax: M },
      steps: [{ customerId: B, amount: current, maxAmount: M, isAuto: false }],
      kind: "raise",
      displacedLeaderId: null,
    };
  }

  // Challenger beats the leader's maximum.
  if (M > L) {
    const current = withReserve(Math.max(before, Math.min(M, L + incrementFor(L, cfg.table))), M, cfg.reservePrice);
    const steps: BidStep[] = [];
    if (L > before) steps.push({ customerId: A, amount: L, maxAmount: L, isAuto: true });
    steps.push({ customerId: B, amount: current, maxAmount: M, isAuto: false });
    return { state: { current, leaderId: B, leadingMax: M }, steps, kind: "new-leader", displacedLeaderId: A };
  }

  // Challenger at or below the leader's maximum: the leader's proxy answers (ties: earlier bid wins).
  const current = withReserve(Math.max(before, Math.min(L, M + incrementFor(M, cfg.table))), L, cfg.reservePrice);
  return {
    state: { current, leaderId: A, leadingMax: L },
    steps: [
      { customerId: B, amount: M, maxAmount: M, isAuto: false },
      { customerId: A, amount: current, maxAmount: L, isAuto: true },
    ],
    kind: "outbid",
    displacedLeaderId: null,
  };
}

export type Submission = { customerId: string; maxAmount: number };

/**
 * Recomputes a lot from its remaining submissions (oldest first) — used after staff void a bid.
 * Submissions that are no longer valid in the replayed state are skipped. `stepsBySubmission[i]` are
 * the rows submission i produces (empty when skipped).
 */
export function replayBids(submissions: readonly Submission[], cfg: EngineConfig): { state: LotState; stepsBySubmission: BidStep[][] } {
  let state: LotState = EMPTY_LOT_STATE;
  const stepsBySubmission: BidStep[][] = [];
  for (const s of submissions) {
    if (!checkBid(state, s, cfg).ok) {
      stepsBySubmission.push([]);
      continue;
    }
    const out = applyBid(state, s, cfg);
    state = out.state;
    stepsBySubmission.push(out.steps);
  }
  return { state, stepsBySubmission };
}

/** Late-bid extension: a bid within `extendSeconds` before the close moves the close to now + extendSeconds. */
export function extendClose(closesAt: Date, now: Date, extendSeconds: number): { closesAt: Date; extended: boolean } {
  const windowMs = Math.max(0, extendSeconds) * 1000;
  if (windowMs === 0 || now.getTime() < closesAt.getTime() - windowMs) return { closesAt, extended: false };
  const next = new Date(now.getTime() + windowMs);
  return next.getTime() > closesAt.getTime() ? { closesAt: next, extended: true } : { closesAt, extended: false };
}

/** Scheduled close of lot `lotNumber` (1-based): DAY = firstCloseAt + (n − 1) × gap; SINGLE = firstCloseAt. */
export function scheduledClose(type: "DAY" | "SINGLE", firstCloseAt: Date, gapSeconds: number, lotNumber: number): Date {
  if (type === "SINGLE") return new Date(firstCloseAt.getTime());
  return new Date(firstCloseAt.getTime() + Math.max(0, lotNumber - 1) * Math.max(0, gapSeconds) * 1000);
}

/** Visible-history rule: a row by the same bidder at the same amount as the previous shown row adds nothing (a leader raising their maximum). */
export function visibleHistory<T extends { customerId: string; amount: number }>(rowsOldestFirst: readonly T[]): T[] {
  const out: T[] = [];
  for (const r of rowsOldestFirst) {
    const prev = out[out.length - 1];
    if (prev && prev.customerId === r.customerId && prev.amount === r.amount) continue;
    out.push(r);
  }
  return out;
}

/** Reserve status for the public: null when there is no reserve. */
export function reserveMet(current: number | null, reservePrice: number | null): boolean | null {
  if (reservePrice === null) return null;
  return current !== null && current >= reservePrice;
}

/** Whether a closed lot is sold: at least one bid and the reserve (if any) reached. */
export function closesAsSold(current: number | null, leaderId: string | null, reservePrice: number | null): boolean {
  return current !== null && leaderId !== null && (reservePrice === null || current >= reservePrice);
}
