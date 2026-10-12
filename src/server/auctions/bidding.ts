import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError } from "@/server/context";
import { assertModule } from "@/server/modules";
import { getSettings } from "@/server/settings";
import { take } from "@/server/auth/rate-limit";
import { enqueue } from "@/server/jobs/queue";
import { requestClientIp } from "@/server/request-meta";
import { resolveCompliance } from "@/server/compliance";
import { requestVisitorCountry } from "@/server/compliance/country";
import { tableOrDefault } from "./increments";
import { applyBid, checkBid, extendClose, type EngineConfig, type LotState } from "./engine";
import { loadPublicLot, type PublicLot } from "./public";
import { AuctionError, notifyLot, signalHash, type Tx } from "./shared";

/*
 * Bidding (docs/auctions.md § Bieden). placeBid is ONE transaction:
 *   1. SELECT … FOR UPDATE on the lot row — concurrent bids on a lot serialise here;
 *   2. idempotency: a (lotId, requestId) seen before returns the current state (no second bid);
 *   3. status/time checked against the DATABASE clock (now() in the transaction), proxy maths
 *      (./engine.ts), late-bid extension (only this lot moves);
 *   4. Bid rows for the visible steps, lot update, pg_notify('auction_<id>') — delivered on commit —,
 *      the outbid notification job and (on an extension) a new close job, all inside the transaction.
 * Eligibility (verified e-mail, not staff, not blocked, terms accepted, age, country) is checked
 * before the lock; terms/blocked are re-checked inside it.
 */

/** A signed-in shop customer acting on this shop (build it from getShopCustomer()). */
export type ShopCustomerContext = {
  tenantId: string;
  customerId: string;
  /** The customer's User id (session user). Optional: looked up from the customer when absent. */
  userId?: string | null;
  /** Client IP for the signals (default: the current request's IP). */
  ip?: string | null;
  /** Visitor country (ISO-2) for compliance (default: the current request's country). */
  country?: string | null;
};

/** ShopCustomerContext from the customer-auth session object (`getShopCustomer()`). */
export function shopCustomerContext(c: { tenant: { id: string }; user: { id: string }; customer: { id: string } }, meta: { ip?: string | null; country?: string | null } = {}): ShopCustomerContext {
  return { tenantId: c.tenant.id, customerId: c.customer.id, userId: c.user.id, ...meta };
}

const idSchema = z.string().trim().min(1).max(64);
const bidSchema = z.object({
  lotId: idSchema,
  maxAmount: z.coerce.number().int().min(1).max(1_000_000_000),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid request id"),
  /** First-party device cookie (qm_dev) — hashed for the signals only. */
  deviceId: z.string().trim().max(200).nullish(),
  /** Age confirmation for age-restricted lots (shops with age verification at checkout). */
  ageConfirmed: z.boolean().optional(),
});
export type PlaceBidInput = z.input<typeof bidSchema>;

export type PlaceBidResult = { ok: true; state: PublicLot; isLeading: boolean; myMax: number; /** additive */ extended: boolean; reused: boolean };

/** Bids per customer per minute (anti-abuse; a real bidder never gets near it). */
const BID_RATE = { limit: 30, windowMs: 60_000 };

// ─── Eligibility ───────────────────────────────────────────────────────────

async function loadBidder(ctx: ShopCustomerContext) {
  const customer = await db.customer.findFirst({
    where: { id: ctx.customerId, tenantId: ctx.tenantId },
    select: {
      id: true,
      email: true,
      userId: true,
      user: { select: { id: true, role: true, emailVerifiedAt: true, disabledAt: true } },
      blockedBidder: { select: { id: true } },
      addresses: { orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], select: { type: true, countryCode: true } },
    },
  });
  if (!customer) throw new ServiceError("NOT_FOUND", "Customer not found");
  if (ctx.userId && customer.userId !== ctx.userId) throw new ServiceError("FORBIDDEN", "Not your account");
  return customer;
}

type Bidder = Awaited<ReturnType<typeof loadBidder>>;

/** Staff (the shop owner or a platform admin) may not bid, also not with a customer account on the same address. */
async function isStaff(tenantId: string, bidder: Bidder): Promise<boolean> {
  if (bidder.user && bidder.user.role !== "CUSTOMER") return true;
  const staff = await db.user.findFirst({
    where: { email: bidder.email.toLowerCase(), role: { in: ["OWNER", "SUPERADMIN"] }, OR: [{ tenantId }, { tenantId: null }] },
    select: { id: true },
  });
  return !!staff;
}

async function assertMayBid(ctx: ShopCustomerContext, bidder: Bidder) {
  if (await isStaff(ctx.tenantId, bidder)) throw new AuctionError("STAFF_CANNOT_BID", "Staff of this shop can't bid");
  if (!bidder.user || bidder.user.disabledAt || !bidder.user.emailVerifiedAt) throw new AuctionError("NOT_VERIFIED", "Please confirm your e-mail address before bidding");
  if (bidder.blockedBidder) throw new AuctionError("BLOCKED", "You can't bid in this shop's auctions");
}

/** Countries whose compliance rules apply: the customer's (shipping, then billing) address and the visitor country. */
async function bidCountries(ctx: ShopCustomerContext, bidder: Bidder): Promise<string[]> {
  const shipping = bidder.addresses.find((a) => a.type === "SHIPPING")?.countryCode;
  const billing = bidder.addresses.find((a) => a.type === "BILLING")?.countryCode;
  const visitor = ctx.country !== undefined ? ctx.country : await requestVisitorCountry();
  return [...new Set([shipping ?? billing, visitor].filter((c): c is string => !!c).map((c) => c.toUpperCase()))];
}

async function assertProductAllowed(ctx: ShopCustomerContext, bidder: Bidder, product: { id: string; ageRestricted: boolean }, ageConfirmed: boolean | undefined) {
  if (product.ageRestricted) {
    const legal = await getSettings(ctx.tenantId, "legal");
    // Same rule as checkout: shops that verify age at checkout ask for the confirmation with the bid.
    if (legal.ageVerification === "checkout" && !ageConfirmed) {
      throw new AuctionError("AGE_RESTRICTED", `Please confirm you are at least ${legal.minimumAge} years old`, { minimumAge: legal.minimumAge });
    }
  }
  for (const country of await bidCountries(ctx, bidder)) {
    const verdict = (await resolveCompliance(ctx.tenantId, [product.id], country))[product.id];
    if (verdict && (verdict.hidden || verdict.noShipping)) {
      throw new AuctionError("COUNTRY_RESTRICTED", "This lot can't be sold to your country", { country });
    }
  }
}

// ─── Terms ─────────────────────────────────────────────────────────────────

/** Registers the customer for the auction: accepts the auction terms and assigns the public bidder number. */
export async function acceptAuctionTerms(ctx: ShopCustomerContext, auctionId: string): Promise<{ bidderNumber: number }> {
  await assertModule(ctx, "auctions");
  const id = idSchema.parse(auctionId);
  const auction = await db.auction.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, status: true } });
  if (!auction || !["PUBLISHED", "LIVE"].includes(auction.status)) throw new AuctionError("LOT_CLOSED", "This auction is not open for registration");
  const bidder = await loadBidder(ctx);
  await assertMayBid(ctx, bidder);

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qm:auction-bidders:${id}`}))`;
    const existing = await tx.auctionBidder.findUnique({ where: { auctionId_customerId: { auctionId: id, customerId: ctx.customerId } }, select: { number: true } });
    if (existing) return { bidderNumber: existing.number, created: false };
    const max = await tx.auctionBidder.aggregate({ where: { auctionId: id }, _max: { number: true } });
    const number = (max._max.number ?? 0) + 1;
    await tx.auctionBidder.create({ data: { tenantId: ctx.tenantId, auctionId: id, customerId: ctx.customerId, number, termsAcceptedAt: new Date() } });
    return { bidderNumber: number, created: true };
  });
  if (result.created) {
    await audit({ action: "auction.bidder.terms", tenantId: ctx.tenantId, entity: "Auction", entityId: id, data: { customerId: ctx.customerId, bidderNumber: result.bidderNumber } });
  }
  return { bidderNumber: result.bidderNumber };
}

// ─── Bidding ───────────────────────────────────────────────────────────────

async function lockLot(tx: Tx, tenantId: string, lotId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM auction_lots WHERE id = ${lotId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (!rows.length) throw new ServiceError("NOT_FOUND", "Lot not found");
  // The server clock after the lock was granted (now() would be the transaction start).
  const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const lot = await tx.auctionLot.findUniqueOrThrow({
    where: { id: lotId },
    include: { auction: { select: { id: true, status: true, opensAt: true, extendSeconds: true, incrementTable: true } } },
  });
  return { lot, now: now instanceof Date ? now : new Date(now) };
}

/** Throws LOT_CLOSED / NOT_OPEN_YET when the lot can't take bids at `now`. */
export function assertBiddable(lot: { status: string; closesAt: Date; auction: { status: string; opensAt: Date } }, now: Date) {
  if (lot.status !== "OPEN" || lot.closesAt.getTime() <= now.getTime() || !["PUBLISHED", "LIVE"].includes(lot.auction.status)) {
    throw new AuctionError("LOT_CLOSED", "Bidding on this lot has closed");
  }
  if (lot.auction.opensAt.getTime() > now.getTime()) throw new AuctionError("NOT_OPEN_YET", "Bidding hasn't opened yet", { opensAt: lot.auction.opensAt.toISOString() });
}

/**
 * Places (or raises) the customer's maximum bid on a lot. See the module comment for the guarantees.
 * Refusals throw AuctionError (reason in `.reason` / `details.reason`); BELOW_MINIMUM carries `details.minimum`.
 */
export async function placeBid(ctx: ShopCustomerContext, input: PlaceBidInput): Promise<PlaceBidResult> {
  await assertModule(ctx, "auctions");
  const parsed = bidSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("INVALID", parsed.error.issues[0]?.message ?? "Invalid bid", parsed.error.issues);
  const data = parsed.data;

  const bidder = await loadBidder(ctx);
  await assertMayBid(ctx, bidder);
  const pre = await db.auctionLot.findFirst({
    where: { id: data.lotId, tenantId: ctx.tenantId },
    select: { auctionId: true, product: { select: { id: true, ageRestricted: true } } },
  });
  if (!pre) throw new ServiceError("NOT_FOUND", "Lot not found");
  await assertProductAllowed(ctx, bidder, pre.product, data.ageConfirmed);

  if (!(await take(`auction.bid:${ctx.tenantId}:${ctx.customerId}`, BID_RATE))) {
    throw new AuctionError("RATE_LIMITED", "You are bidding very fast. Please wait a moment.");
  }

  const ip = ctx.ip !== undefined ? ctx.ip : await requestClientIp();
  const ipHash = signalHash(ctx.tenantId, "ip", ip);
  const deviceHash = signalHash(ctx.tenantId, "device", data.deviceId);

  const out = await db.$transaction(
    async (tx) => {
      const { lot, now } = await lockLot(tx, ctx.tenantId, data.lotId);

      // Idempotency: the same request again (retry, double click) returns the current state.
      const seen = await tx.bid.findUnique({ where: { lotId_requestId: { lotId: lot.id, requestId: data.requestId } }, select: { customerId: true, maxAmount: true } });
      if (seen) {
        if (seen.customerId !== ctx.customerId) throw new ServiceError("CONFLICT", "Duplicate request id");
        return { lot, reused: true as const, extended: false, displaced: null as string | null, myMax: Math.max(seen.maxAmount, lot.leadingBidderId === ctx.customerId ? (lot.leadingMax ?? 0) : 0) };
      }

      assertBiddable(lot, now);
      const registered = await tx.auctionBidder.findUnique({ where: { auctionId_customerId: { auctionId: lot.auctionId, customerId: ctx.customerId } }, select: { id: true } });
      if (!registered) throw new AuctionError("TERMS_REQUIRED", "Please accept the auction terms first");
      const blocked = await tx.blockedBidder.findFirst({ where: { tenantId: ctx.tenantId, customerId: ctx.customerId }, select: { id: true } });
      if (blocked) throw new AuctionError("BLOCKED", "You can't bid in this shop's auctions");

      const cfg: EngineConfig = { startPrice: lot.startPrice, reservePrice: lot.reservePrice, table: tableOrDefault(lot.auction.incrementTable) };
      const state: LotState = { current: lot.currentBid, leaderId: lot.leadingBidderId, leadingMax: lot.leadingMax };
      const check = checkBid(state, { customerId: ctx.customerId, maxAmount: data.maxAmount }, cfg);
      if (!check.ok) throw new AuctionError("BELOW_MINIMUM", "Your maximum is below the minimum bid", { minimum: check.minimum });

      const result = applyBid(state, { customerId: ctx.customerId, maxAmount: data.maxAmount }, cfg);
      const ext = extendClose(lot.closesAt, now, lot.auction.extendSeconds);

      // Rows in order (createdAt + i ms keeps the challenger before the automatic answer).
      await tx.bid.createMany({
        data: result.steps.map((s, i) => ({
          tenantId: ctx.tenantId,
          lotId: lot.id,
          customerId: s.customerId,
          amount: s.amount,
          maxAmount: s.maxAmount,
          isAuto: s.isAuto,
          requestId: s.customerId === ctx.customerId && !s.isAuto ? data.requestId : null,
          ipHash: s.customerId === ctx.customerId && !s.isAuto ? ipHash : null,
          deviceHash: s.customerId === ctx.customerId && !s.isAuto ? deviceHash : null,
          createdAt: new Date(now.getTime() + i),
        })),
      });
      await tx.auctionLot.update({
        where: { id: lot.id },
        data: {
          currentBid: result.state.current,
          leadingBidderId: result.state.leaderId,
          leadingMax: result.state.leadingMax,
          bidCount: { increment: result.steps.length },
          ...(ext.extended ? { closesAt: ext.closesAt, extended: true } : {}),
        },
      });
      // A PUBLISHED auction whose opening time passed takes bids already; flip it LIVE now.
      if (lot.auction.status === "PUBLISHED") await tx.auction.updateMany({ where: { id: lot.auctionId, status: "PUBLISHED" }, data: { status: "LIVE" } });
      if (ext.extended) await enqueue("auctions.close-lot", { lotId: lot.id }, { tx, startAfter: ext.closesAt, singletonKey: `${lot.id}:${ext.closesAt.getTime()}` });
      if (result.displacedLeaderId) {
        await enqueue("auctions.notify", { kind: "outbid", lotId: lot.id, customerId: result.displacedLeaderId }, { tx });
      }
      await notifyLot(tx, lot.auctionId, lot.id);
      return {
        lot,
        reused: false as const,
        extended: ext.extended,
        displaced: result.displacedLeaderId,
        myMax: data.maxAmount,
        kind: result.kind,
        current: result.state.current,
      };
    },
    { timeout: 15_000, maxWait: 10_000 },
  );

  const state = await loadPublicLot(ctx.tenantId, data.lotId);
  if (!state) throw new ServiceError("NOT_FOUND", "Lot not found");
  if (!out.reused) {
    await audit({
      action: "auction.bid",
      tenantId: ctx.tenantId,
      entity: "AuctionLot",
      entityId: data.lotId,
      data: { customerId: ctx.customerId, maxAmount: data.maxAmount, current: state.currentBid, extended: out.extended, displaced: out.displaced, requestId: data.requestId },
    });
  }
  const mine = await db.auctionLot.findUniqueOrThrow({ where: { id: data.lotId }, select: { leadingBidderId: true, leadingMax: true } });
  const isLeading = mine.leadingBidderId === ctx.customerId;
  return { ok: true, state, isLeading, myMax: isLeading ? (mine.leadingMax ?? out.myMax) : out.myMax, extended: out.extended, reused: out.reused };
}
