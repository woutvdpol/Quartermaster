"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getShopCustomer } from "@/server/customer-auth/current";
import { getOpenShopTenant } from "@/server/storefront/launch";
import { acceptAuctionTerms, placeBid, shopCustomerContext } from "@/server/auctions/bidding";
import { getMyLotState, loadPublicLot, lotHistory } from "@/server/auctions/public";
import { auctionErrorReason } from "@/server/auctions/shared";
import { ServiceError } from "@/server/context";
import type { BidErrorCode, BidFailure, BidResult, LotRefresh, MyPosition, TermsResult } from "./lib/results";

/*
 * Shop auction actions: place a bid, accept the auction terms, refresh one lot (history + own position)
 * after a stream event. Everything is decided by the engine (src/server/auctions); these only resolve
 * the signed-in customer of this host and translate refusals into codes the bid box localises.
 */

/** First-party device id for the bid signals (the engine HMACs it; never shown). */
const DEVICE_COOKIE = "qm_dev";
const DEVICE_MAX_AGE = 60 * 60 * 24 * 365;

async function deviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const fresh = randomBytes(18).toString("base64url");
  jar.set(DEVICE_COOKIE, fresh, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: DEVICE_MAX_AGE });
  return fresh;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

async function customer() {
  const tenant = await getOpenShopTenant();
  if (!tenant) return null;
  const c = await getShopCustomer();
  return c && c.tenant.id === tenant.id ? c : null;
}

function failure(err: unknown): BidFailure {
  const reason = auctionErrorReason(err);
  if (reason) {
    const details = err instanceof ServiceError && err.details && typeof err.details === "object" ? (err.details as Record<string, unknown>) : {};
    return { ok: false, code: reason, ...(typeof details.minimum === "number" ? { minimum: details.minimum } : {}) };
  }
  if (err instanceof ServiceError) {
    const details = err.details && typeof err.details === "object" && !Array.isArray(err.details) ? (err.details as Record<string, unknown>) : {};
    if (details.reason === "RATE_LIMITED") return { ok: false, code: "RATE_LIMITED" };
    if (err.code === "INVALID") return { ok: false, code: "INVALID_AMOUNT" };
    if (err.code === "NOT_FOUND") return { ok: false, code: "LOT_CLOSED" };
    return { ok: false, code: "GENERIC" };
  }
  console.error("[auctions] shop action failed", err instanceof Error ? err.message : err);
  return { ok: false, code: "GENERIC" };
}

const fail = (code: BidErrorCode): BidFailure => ({ ok: false, code });

async function position(tenantId: string, lotId: string, customerId: string): Promise<MyPosition> {
  const s = await getMyLotState(tenantId, lotId, customerId);
  return { isLeading: s.isLeading, myMax: s.myMax, bidderNumber: s.bidderNumber, termsAccepted: s.termsAccepted, hasBid: s.myMax !== null };
}

async function refresh(tenantId: string, lotId: string, customerId: string | null): Promise<LotRefresh> {
  const lot = await loadPublicLot(tenantId, lotId);
  if (!lot) return { lot: null, history: [], mine: null };
  const [history, mine] = await Promise.all([lotHistory(tenantId, lot.auctionId, lot.id), customerId ? position(tenantId, lot.id, customerId) : Promise.resolve(null)]);
  return { lot, history, mine };
}

/** Places (or raises) the signed-in customer's maximum bid. `maxAmount` in minor units (parsed in the bid box). */
export async function placeBidAction(input: { lotId: unknown; maxAmount: unknown; requestId: unknown; ageConfirmed?: unknown }): Promise<BidResult> {
  const lotId = typeof input?.lotId === "string" && ID.test(input.lotId) ? input.lotId : null;
  const requestId = typeof input?.requestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(input.requestId) ? input.requestId : null;
  const maxAmount = typeof input?.maxAmount === "number" && Number.isSafeInteger(input.maxAmount) && input.maxAmount > 0 ? input.maxAmount : null;
  if (!lotId || !requestId) return fail("GENERIC");
  if (maxAmount === null) return fail("INVALID_AMOUNT");
  const c = await customer();
  if (!c) return fail("LOGIN_REQUIRED");
  try {
    await placeBid(shopCustomerContext(c), { lotId, maxAmount, requestId, deviceId: await deviceId(), ageConfirmed: input.ageConfirmed === true });
  } catch (err) {
    return failure(err);
  }
  try {
    return { ok: true, ...(await refresh(c.tenant.id, lotId, c.customer.id)) };
  } catch {
    // The bid stands; the stream brings the new state.
    return { ok: true, lot: null, history: [], mine: null };
  }
}

/** Accepts the auction terms (first bid in an auction) → the customer's bidder number. */
export async function acceptTermsAction(auctionId: unknown): Promise<TermsResult> {
  if (typeof auctionId !== "string" || !ID.test(auctionId)) return fail("GENERIC");
  const c = await customer();
  if (!c) return fail("LOGIN_REQUIRED");
  try {
    const r = await acceptAuctionTerms(shopCustomerContext(c), auctionId);
    return { ok: true, bidderNumber: r.bidderNumber };
  } catch (err) {
    return failure(err);
  }
}

/** History + own position of one lot (after a stream event). Guests get the history only. */
export async function refreshLotAction(lotId: unknown): Promise<LotRefresh> {
  if (typeof lotId !== "string" || !ID.test(lotId)) return { lot: null, history: [], mine: null };
  const tenant = await getOpenShopTenant();
  if (!tenant) return { lot: null, history: [], mine: null };
  const c = await customer();
  return refresh(tenant.id, lotId, c?.customer.id ?? null);
}
