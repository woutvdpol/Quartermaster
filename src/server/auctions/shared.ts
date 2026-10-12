import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey } from "@/server/auth/encryption";
import { ServiceError } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";

/*
 * Shared bits of the auction service (docs/auctions.md): error type, signal hashes, the winner's
 * personal payment token and the realtime channel name.
 */

export type Tx = Prisma.TransactionClient;

// ─── Errors ────────────────────────────────────────────────────────────────

/** Why a bid (or terms acceptance) was refused. The shop maps these to its NL/DE/EN copy (./_copy.ts). */
export type AuctionErrorCode =
  | "LOT_CLOSED"
  | "NOT_OPEN_YET"
  | "BELOW_MINIMUM"
  | "BLOCKED"
  | "TERMS_REQUIRED"
  | "AGE_RESTRICTED"
  | "COUNTRY_RESTRICTED"
  | "STAFF_CANNOT_BID"
  | "NOT_VERIFIED"
  /** additive: more than 30 bids a minute from one customer */
  | "RATE_LIMITED";

const BASE_CODE: Record<AuctionErrorCode, ServiceError["code"]> = {
  LOT_CLOSED: "CONFLICT",
  NOT_OPEN_YET: "CONFLICT",
  BELOW_MINIMUM: "INVALID",
  BLOCKED: "FORBIDDEN",
  TERMS_REQUIRED: "FORBIDDEN",
  AGE_RESTRICTED: "FORBIDDEN",
  COUNTRY_RESTRICTED: "FORBIDDEN",
  STAFF_CANNOT_BID: "FORBIDDEN",
  NOT_VERIFIED: "FORBIDDEN",
  RATE_LIMITED: "UNAVAILABLE",
};

/**
 * A refused bid. It IS a ServiceError (code = the generic NOT_FOUND/CONFLICT/INVALID/FORBIDDEN class,
 * so existing error mappers keep working); the specific reason is `reason` and `details.reason`
 * (same convention as fair mode). BELOW_MINIMUM carries `details.minimum` (minor units).
 */
export class AuctionError extends ServiceError {
  constructor(
    public readonly reason: AuctionErrorCode,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(BASE_CODE[reason], message, { reason, ...extra });
    this.name = "AuctionError";
  }
}

/** The auction reason of any error (null when it isn't an auction refusal). */
export function auctionErrorReason(err: unknown): AuctionErrorCode | null {
  if (err instanceof AuctionError) return err.reason;
  if (err instanceof ServiceError && err.details && typeof err.details === "object" && "reason" in err.details) {
    const r = (err.details as { reason: unknown }).reason;
    if (typeof r === "string" && r in BASE_CODE) return r as AuctionErrorCode;
  }
  return null;
}

// ─── Hashes for the signals (never shown) ─────────────────────────────────

/** HMAC of an IP / device id, per tenant (hashes can't be linked across shops). 32 hex chars. */
export function signalHash(tenantId: string, kind: "ip" | "device", value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return createHmac("sha256", deriveKey("auction-signals")).update(`${kind}:${tenantId}:${v}`).digest("hex").slice(0, 32);
}

// ─── Winner's payment link ─────────────────────────────────────────────────

function paySignature(tenantId: string, lotId: string, orderId: string): string {
  return createHmac("sha256", deriveKey("auction-pay")).update(`${tenantId}:${lotId}:${orderId}`).digest("base64url").slice(0, 32);
}

/**
 * Personal payment token for a won lot: "<lotId>.<signature>". Stateless (HMAC over tenant, lot and
 * order), so no secret is stored; it stops working when the lot's order changes or is cancelled.
 */
export function payToken(tenantId: string, lotId: string, orderId: string): string {
  return `${lotId}.${paySignature(tenantId, lotId, orderId)}`;
}

/** Splits a token; null when malformed. */
export function parsePayToken(token: string): { lotId: string; signature: string } | null {
  const m = /^([a-z0-9]{8,40})\.([A-Za-z0-9_-]{32})$/.exec(token ?? "");
  return m ? { lotId: m[1], signature: m[2] } : null;
}

export function payTokenMatches(tenantId: string, lotId: string, orderId: string, signature: string): boolean {
  const expected = Buffer.from(paySignature(tenantId, lotId, orderId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ─── Realtime ──────────────────────────────────────────────────────────────

/** Postgres NOTIFY channel of an auction (ids are cuids: lower-case alphanumerics). */
export function auctionChannel(auctionId: string): string {
  if (!/^[a-z0-9]{1,50}$/.test(auctionId)) throw new Error(`Invalid auction id for a channel: ${auctionId}`);
  return `auction_${auctionId}`;
}

/** NOTIFY inside the caller's transaction: delivered to listeners only when it commits. */
export async function notifyLot(tx: Tx, auctionId: string, lotId: string) {
  await tx.$executeRaw`SELECT pg_notify(${auctionChannel(auctionId)}, ${JSON.stringify({ lotId })})`;
}

/** Minutes for `days` (pay window). */
export const DAY_MS = 24 * 60 * 60 * 1000;
