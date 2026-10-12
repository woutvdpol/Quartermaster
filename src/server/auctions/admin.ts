import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { parseInput, isUniqueViolation } from "@/server/catalog/errors";
import { slugify } from "@/server/catalog/slug";
import { imageUrl } from "@/server/media/product-images";
import { enqueue } from "@/server/jobs/queue";
import { queueMail } from "@/server/mail/queue";
import { cancelOrder } from "@/server/orders/commands";
import { Prisma } from "@/generated/prisma/client";
import type { AuctionLotStatus, AuctionStatus, AuctionType, PaymentStatus } from "@/generated/prisma/enums";
import { DEFAULT_INCREMENT_TABLE, defaultReservePrice, defaultStartPrice, nextMinimum, parseIncrementTable, tableOrDefault, type IncrementTable } from "./increments";
import { replayBids, reserveMet, scheduledClose } from "./engine";
import { DAY_MS, auctionChannel, notifyLot, type Tx } from "./shared";

/*
 * Staff side of auctions (docs/auctions.md): set-up, publishing (holds), lots, live monitor, results,
 * voiding bids, blocking bidders, signals and won-lot follow-up. Every function takes the
 * ServiceContext and filters by ctx.tenantId; mutations are audited as "auction.*" (which also
 * refreshes the shop catalog cache, since holds change what the shop lists).
 *
 * Lifecycle: DRAFT → (publish) PUBLISHED → (opensAt, tick) LIVE → (last lot closed) CLOSED; CANCELLED
 * from any state before CLOSED. Lots keep a fixed schedule until the auction is LIVE.
 */

const idSchema = z.string().trim().min(1).max(64);
const dateSchema = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Enter a valid date");
const moneySchema = z.coerce.number().int().min(100, "At least 1.00").max(1_000_000_000);
const incrementSchema = z
  .array(z.object({ upTo: z.number().int().positive().nullable(), step: z.number().int().positive() }))
  .nullish()
  .refine((t) => !t || parseIncrementTable(t) !== null, "Invalid increment table");

const auctionSchema = z.object({
  type: z.enum(["DAY", "SINGLE"]).default("DAY"),
  title: z.string().trim().min(2, "Enter a title").max(160),
  slug: z.string().trim().max(80).nullish(),
  description: z.string().trim().max(20_000).nullish(),
  opensAt: dateSchema,
  firstCloseAt: dateSchema,
  gapSeconds: z.coerce.number().int().min(0).max(3600).default(60),
  extendSeconds: z.coerce.number().int().min(0).max(3600).default(120),
  payDays: z.coerce.number().int().min(1).max(60).default(5),
  incrementTable: incrementSchema,
});
export type AuctionInput = z.input<typeof auctionSchema>;
const auctionPatchSchema = auctionSchema.omit({ type: true }).partial();
export type AuctionPatch = z.input<typeof auctionPatchSchema>;

const ACTOR = (ctx: ServiceContext) => ({ tenantId: ctx.tenantId, actorId: ctx.actor.id });

function checkSchedule(opensAt: Date, firstCloseAt: Date) {
  if (firstCloseAt.getTime() <= opensAt.getTime()) {
    throw new ServiceError("INVALID", "firstCloseAt: The first lot must close after bidding opens", [{ path: "firstCloseAt", message: "Must be after the opening time" }]);
  }
}

async function lockAuction(tx: Tx, tenantId: string, auctionId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM auctions WHERE id = ${auctionId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (!rows.length) throw new ServiceError("NOT_FOUND", "Auction not found");
  return tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
}

async function lockLotRow(tx: Tx, tenantId: string, lotId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM auction_lots WHERE id = ${lotId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (!rows.length) throw new ServiceError("NOT_FOUND", "Lot not found");
  return tx.auctionLot.findUniqueOrThrow({ where: { id: lotId }, include: { auction: true } });
}

/** Slugs taken by static shop routes (/auctions/lot/…, /auctions/terms, /auctions/pay/…). */
export const RESERVED_AUCTION_SLUGS: ReadonlySet<string> = new Set(["lot", "terms", "pay"]);

async function uniqueSlug(tenantId: string, base: string, exceptId?: string, explicit = false): Promise<string> {
  const root = slugify(base) || "auction";
  if (explicit && RESERVED_AUCTION_SLUGS.has(root)) {
    throw new ServiceError("INVALID", "slug: This web address is reserved", [{ path: "slug", message: "Reserved — choose another" }]);
  }
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    if (RESERVED_AUCTION_SLUGS.has(candidate)) continue;
    const taken = await db.auction.findFirst({ where: { tenantId, slug: candidate, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

// ─── Auction CRUD ───────────────────────────────────────────────────────────

export async function createAuction(ctx: ServiceContext, input: AuctionInput): Promise<{ id: string; slug: string }> {
  const data = parseInput(auctionSchema, input);
  checkSchedule(data.opensAt, data.firstCloseAt);
  const slug = await uniqueSlug(ctx.tenantId, data.slug || data.title, undefined, !!data.slug);
  try {
    const a = await db.auction.create({
      data: {
        tenantId: ctx.tenantId,
        type: data.type,
        title: data.title,
        slug,
        description: data.description || null,
        opensAt: data.opensAt,
        firstCloseAt: data.firstCloseAt,
        gapSeconds: data.type === "SINGLE" ? 0 : data.gapSeconds,
        extendSeconds: data.extendSeconds,
        payDays: data.payDays,
        incrementTable: data.incrementTable ? (data.incrementTable as Prisma.InputJsonValue) : Prisma.DbNull,
      },
      select: { id: true, slug: true },
    });
    await audit({ action: "auction.create", ...ACTOR(ctx), entity: "Auction", entityId: a.id, data: { title: data.title, type: data.type } });
    return a;
  } catch (err) {
    if (isUniqueViolation(err, "slug")) throw new ServiceError("CONFLICT", "slug: This web address is already used by another auction", [{ path: "slug", message: "Already in use" }]);
    throw err;
  }
}

/** Recomputes every non-cancelled lot's scheduled close (only before the auction is LIVE). */
async function rescheduleLots(tx: Tx, auction: { id: string; type: AuctionType; firstCloseAt: Date; gapSeconds: number; status: AuctionStatus }) {
  const lots = await tx.auctionLot.findMany({ where: { auctionId: auction.id, status: "OPEN" }, select: { id: true, lotNumber: true } });
  for (const l of lots) {
    const closesAt = scheduledClose(auction.type, auction.firstCloseAt, auction.gapSeconds, l.lotNumber);
    await tx.auctionLot.update({ where: { id: l.id }, data: { closesAt, extended: false } });
    if (auction.status === "PUBLISHED") await enqueue("auctions.close-lot", { lotId: l.id }, { tx, startAfter: closesAt, singletonKey: `${l.id}:${closesAt.getTime()}` });
  }
}

/**
 * Edits an auction. Title/description/pay days can always change (until CLOSED/CANCELLED); the schedule
 * and increments only before the auction is LIVE (lot closes are recomputed).
 */
export async function updateAuction(ctx: ServiceContext, auctionId: string, input: AuctionPatch) {
  const id = idSchema.parse(auctionId);
  const data = parseInput(auctionPatchSchema, input);
  const slug = data.slug ? await uniqueSlug(ctx.tenantId, data.slug, id, true) : undefined;
  await db.$transaction(async (tx) => {
    const a = await lockAuction(tx, ctx.tenantId, id);
    if (a.status === "CLOSED" || a.status === "CANCELLED") throw new ServiceError("CONFLICT", "This auction is closed and can't be changed");
    const scheduleChange =
      (data.opensAt && data.opensAt.getTime() !== a.opensAt.getTime()) ||
      (data.firstCloseAt && data.firstCloseAt.getTime() !== a.firstCloseAt.getTime()) ||
      (data.gapSeconds !== undefined && data.gapSeconds !== a.gapSeconds) ||
      (data.extendSeconds !== undefined && data.extendSeconds !== a.extendSeconds) ||
      data.incrementTable !== undefined;
    if (scheduleChange && a.status === "LIVE") throw new ServiceError("CONFLICT", "The schedule can't change while bidding is open");
    const opensAt = data.opensAt ?? a.opensAt;
    const firstCloseAt = data.firstCloseAt ?? a.firstCloseAt;
    checkSchedule(opensAt, firstCloseAt);
    const updated = await tx.auction.update({
      where: { id },
      data: {
        title: data.title,
        slug,
        description: data.description === undefined ? undefined : data.description || null,
        opensAt,
        firstCloseAt,
        gapSeconds: a.type === "SINGLE" ? 0 : data.gapSeconds,
        extendSeconds: data.extendSeconds,
        payDays: data.payDays,
        incrementTable: data.incrementTable === undefined ? undefined : data.incrementTable ? (data.incrementTable as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    if (scheduleChange) await rescheduleLots(tx, updated);
    await tx.$executeRaw`SELECT pg_notify(${auctionChannel(id)}, ${JSON.stringify({ auction: "updated" })})`;
  });
  await audit({ action: "auction.update", ...ACTOR(ctx), entity: "Auction", entityId: id, data: { fields: Object.keys(data) } });
}

// ─── Product eligibility / holds ────────────────────────────────────────────

type Candidate = { id: string; stockCode: number; status: string; quantity: number; fairHoldId: string | null; auctionHoldId: string | null };

/** Products that can't become (or stay) lots of `auctionId`, with the reason. */
async function blockers(tx: Tx, tenantId: string, products: Candidate[], auctionId: string): Promise<{ stockCode: number; reason: string }[]> {
  const out: { stockCode: number; reason: string }[] = [];
  const now = new Date();
  const ids = products.map((p) => p.id);
  const [reserved, otherLots] = await Promise.all([
    tx.reservation.findMany({ where: { tenantId, productId: { in: ids }, status: "ACTIVE", expiresAt: { gt: now } }, select: { productId: true } }),
    tx.auctionLot.findMany({
      where: { tenantId, productId: { in: ids }, auctionId: { not: auctionId }, status: { in: ["OPEN", "SOLD"] }, auction: { status: { in: ["DRAFT", "PUBLISHED", "LIVE"] } } },
      select: { productId: true },
    }),
  ]);
  const reservedIds = new Set(reserved.map((r) => r.productId));
  const lotIds = new Set(otherLots.map((r) => r.productId));
  for (const p of products) {
    if (p.status !== "ACTIVE" || p.quantity <= 0) out.push({ stockCode: p.stockCode, reason: "not for sale" });
    else if (p.fairHoldId) out.push({ stockCode: p.stockCode, reason: "on a fair" });
    else if (p.auctionHoldId && p.auctionHoldId !== auctionId) out.push({ stockCode: p.stockCode, reason: "in another auction" });
    else if (lotIds.has(p.id)) out.push({ stockCode: p.stockCode, reason: "in another auction" });
    else if (reservedIds.has(p.id)) out.push({ stockCode: p.stockCode, reason: "in a customer's cart" });
  }
  return out;
}

function blockerError(list: { stockCode: number; reason: string }[]) {
  return new ServiceError("CONFLICT", `Not possible for: ${list.map((b) => `No. ${b.stockCode} (${b.reason})`).join(", ")}`, { reason: "unavailable", products: list });
}

const candidateSelect = { id: true, stockCode: true, status: true, quantity: true, fairHoldId: true, auctionHoldId: true, price: true, purchasePrice: true } as const;

/** Adds products as lots (appended). Defaults: start = 60% of list price, reserve = purchase price + 10%. */
export async function addLots(ctx: ServiceContext, auctionId: string, productIds: string[]): Promise<{ added: number; lotIds: string[] }> {
  const id = idSchema.parse(auctionId);
  const ids = [...new Set(parseInput(z.array(idSchema).min(1, "Choose at least one item").max(500), productIds))];
  const result = await db.$transaction(
    async (tx) => {
      const a = await lockAuction(tx, ctx.tenantId, id);
      if (a.status !== "DRAFT" && a.status !== "PUBLISHED") throw new ServiceError("CONFLICT", "Lots can only be added before bidding opens");
      const existing = await tx.auctionLot.findMany({ where: { auctionId: id }, select: { productId: true, lotNumber: true, status: true } });
      const active = existing.filter((l) => l.status !== "CANCELLED");
      const fresh = ids.filter((pid) => !existing.some((l) => l.productId === pid));
      if (a.type === "SINGLE" && active.length + fresh.length > 1) throw new ServiceError("CONFLICT", "A single-lot auction has exactly one lot");
      if (!fresh.length) return { added: 0, lotIds: [] as string[] };
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE id = ANY(${fresh}::text[]) AND "tenantId" = ${ctx.tenantId} ORDER BY id FOR UPDATE`;
      if (locked.length !== fresh.length) throw new ServiceError("NOT_FOUND", "Item not found");
      const products = await tx.product.findMany({ where: { id: { in: fresh } }, select: candidateSelect });
      const blocked = await blockers(tx, ctx.tenantId, products, id);
      if (blocked.length) throw blockerError(blocked);
      let n = existing.reduce((m, l) => Math.max(m, l.lotNumber), 0);
      const lotIds: string[] = [];
      for (const pid of fresh) {
        const p = products.find((x) => x.id === pid)!;
        n += 1;
        const closesAt = scheduledClose(a.type, a.firstCloseAt, a.gapSeconds, n);
        const lot = await tx.auctionLot.create({
          data: {
            tenantId: ctx.tenantId,
            auctionId: id,
            productId: pid,
            lotNumber: n,
            startPrice: defaultStartPrice(p.price),
            reservePrice: defaultReservePrice(p.purchasePrice, p.price),
            closesAt,
          },
          select: { id: true },
        });
        lotIds.push(lot.id);
        if (a.status === "PUBLISHED") {
          await tx.product.update({ where: { id: pid }, data: { auctionHoldId: id } });
          await enqueue("auctions.close-lot", { lotId: lot.id }, { tx, startAfter: closesAt, singletonKey: `${lot.id}:${closesAt.getTime()}` });
        }
      }
      return { added: lotIds.length, lotIds };
    },
    { timeout: 30_000 },
  );
  if (result.added) await audit({ action: "auction.lots.add", ...ACTOR(ctx), entity: "Auction", entityId: id, data: { productIds: ids, added: result.added } });
  return result;
}

const lotPatchSchema = z.object({
  startPrice: moneySchema.optional(),
  reservePrice: moneySchema.nullish(),
  lotNumber: z.coerce.number().int().min(1).max(10_000).optional(),
});

/** Start/reserve price and position of a lot — before the auction is LIVE, or (prices) while it has no bid yet. */
export async function updateLot(ctx: ServiceContext, lotId: string, input: z.input<typeof lotPatchSchema>) {
  const id = idSchema.parse(lotId);
  const data = parseInput(lotPatchSchema, input);
  let reorderTo: number | null = null;
  let auctionId = "";
  await db.$transaction(async (tx) => {
    const lot = await lockLotRow(tx, ctx.tenantId, id);
    auctionId = lot.auctionId;
    if (lot.status !== "OPEN" || lot.auction.status === "CLOSED" || lot.auction.status === "CANCELLED") throw new ServiceError("CONFLICT", "This lot is closed");
    const live = lot.auction.status === "LIVE";
    if (live && lot.bidCount > 0 && (data.startPrice !== undefined || data.reservePrice !== undefined)) {
      throw new ServiceError("CONFLICT", "Prices can't change after the first bid");
    }
    if (data.lotNumber !== undefined && data.lotNumber !== lot.lotNumber) {
      if (live) throw new ServiceError("CONFLICT", "Lots can't be reordered while bidding is open");
      reorderTo = data.lotNumber;
    }
    await tx.auctionLot.update({
      where: { id },
      data: { startPrice: data.startPrice, reservePrice: data.reservePrice === undefined ? undefined : data.reservePrice },
    });
    await notifyLot(tx, lot.auctionId, id);
  });
  if (reorderTo !== null) {
    const lots = await db.auctionLot.findMany({ where: { auctionId, status: { not: "CANCELLED" } }, orderBy: { lotNumber: "asc" }, select: { id: true } });
    const order = lots.map((l) => l.id).filter((x) => x !== id);
    order.splice(Math.min(Math.max((reorderTo as number) - 1, 0), order.length), 0, id);
    await reorderLots(ctx, auctionId, order);
  }
  await audit({ action: "auction.lot.update", ...ACTOR(ctx), entity: "AuctionLot", entityId: id, data });
}

/** Renumbers lots 1..n in the given order (cancelled lots go last) and recomputes the closes. Before LIVE only. */
export async function reorderLots(ctx: ServiceContext, auctionId: string, lotIds: string[]) {
  const id = idSchema.parse(auctionId);
  const order = parseInput(z.array(idSchema).max(10_000), lotIds);
  await db.$transaction(async (tx) => {
    const a = await lockAuction(tx, ctx.tenantId, id);
    if (a.status !== "DRAFT" && a.status !== "PUBLISHED") throw new ServiceError("CONFLICT", "Lots can't be reordered while bidding is open");
    const lots = await tx.auctionLot.findMany({ where: { auctionId: id }, orderBy: { lotNumber: "asc" }, select: { id: true, status: true } });
    const live = lots.filter((l) => l.status !== "CANCELLED").map((l) => l.id);
    if (order.length !== live.length || new Set(order).size !== order.length || order.some((x) => !live.includes(x))) {
      throw new ServiceError("INVALID", "The new order must list every lot exactly once");
    }
    const final = [...order, ...lots.filter((l) => l.status === "CANCELLED").map((l) => l.id)];
    // Two passes: (auctionId, lotNumber) is unique.
    await tx.$executeRaw`UPDATE auction_lots SET "lotNumber" = "lotNumber" + 100000 WHERE "auctionId" = ${id}`;
    for (let i = 0; i < final.length; i++) await tx.auctionLot.update({ where: { id: final[i] }, data: { lotNumber: i + 1 } });
    await rescheduleLots(tx, a);
  });
  await audit({ action: "auction.lots.reorder", ...ACTOR(ctx), entity: "Auction", entityId: id });
}

/** Removes a lot: deleted while DRAFT; otherwise CANCELLED (only without bids) and the product goes back to the shop. */
export async function removeLot(ctx: ServiceContext, lotId: string) {
  const id = idSchema.parse(lotId);
  const out = await db.$transaction(async (tx) => {
    const lot = await lockLotRow(tx, ctx.tenantId, id);
    if (lot.status !== "OPEN") throw new ServiceError("CONFLICT", "This lot is already closed");
    if (lot.bidCount > 0) throw new ServiceError("CONFLICT", "This lot has bids — void them first");
    await tx.product.updateMany({ where: { id: lot.productId, auctionHoldId: lot.auctionId }, data: { auctionHoldId: null } });
    if (lot.auction.status === "DRAFT") {
      await tx.auctionLot.delete({ where: { id } });
      const rest = await tx.auctionLot.findMany({ where: { auctionId: lot.auctionId }, orderBy: { lotNumber: "asc" }, select: { id: true } });
      await tx.$executeRaw`UPDATE auction_lots SET "lotNumber" = "lotNumber" + 100000 WHERE "auctionId" = ${lot.auctionId}`;
      for (let i = 0; i < rest.length; i++) await tx.auctionLot.update({ where: { id: rest[i].id }, data: { lotNumber: i + 1 } });
      await rescheduleLots(tx, lot.auction);
      return { auctionId: lot.auctionId, deleted: true };
    }
    await tx.auctionLot.update({ where: { id }, data: { status: "CANCELLED", closedAt: new Date() } });
    await notifyLot(tx, lot.auctionId, id);
    return { auctionId: lot.auctionId, deleted: false };
  });
  await audit({ action: "auction.lot.remove", ...ACTOR(ctx), entity: "AuctionLot", entityId: id, data: out });
}

/**
 * DRAFT → PUBLISHED: the lots become visible (bidding opens at opensAt), their products get the auction
 * hold (hidden from the shop, not reservable), the closes are fixed and a close job is queued per lot.
 */
export async function publishAuction(ctx: ServiceContext, auctionId: string) {
  const id = idSchema.parse(auctionId);
  const res = await db.$transaction(
    async (tx) => {
      const a = await lockAuction(tx, ctx.tenantId, id);
      if (a.status !== "DRAFT") throw new ServiceError("CONFLICT", "Only a draft auction can be published");
      if (a.firstCloseAt.getTime() <= Date.now()) throw new ServiceError("INVALID", "firstCloseAt: The first lot must close in the future", [{ path: "firstCloseAt", message: "Must be in the future" }]);
      const lots = await tx.auctionLot.findMany({ where: { auctionId: id, status: "OPEN" }, select: { productId: true } });
      if (!lots.length) throw new ServiceError("INVALID", "Add at least one lot before publishing");
      const pids = lots.map((l) => l.productId).sort();
      await tx.$queryRaw`SELECT id FROM products WHERE id = ANY(${pids}::text[]) AND "tenantId" = ${ctx.tenantId} ORDER BY id FOR UPDATE`;
      const products = await tx.product.findMany({ where: { id: { in: pids } }, select: candidateSelect });
      const blocked = await blockers(tx, ctx.tenantId, products, id);
      if (blocked.length) throw blockerError(blocked);
      await tx.product.updateMany({ where: { id: { in: pids }, tenantId: ctx.tenantId }, data: { auctionHoldId: id } });
      const published = await tx.auction.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      await rescheduleLots(tx, published);
      return { lots: lots.length };
    },
    { timeout: 30_000 },
  );
  await audit({ action: "auction.publish", ...ACTOR(ctx), entity: "Auction", entityId: id, data: res });
  return res;
}

/** Cancels an auction (before CLOSED): open lots → CANCELLED, their products back in the shop. Won lots are not touched. */
export async function cancelAuction(ctx: ServiceContext, auctionId: string) {
  const id = idSchema.parse(auctionId);
  const res = await db.$transaction(async (tx) => {
    const a = await lockAuction(tx, ctx.tenantId, id);
    if (a.status === "CLOSED" || a.status === "CANCELLED") throw new ServiceError("CONFLICT", "This auction is already closed");
    const open = await tx.auctionLot.findMany({ where: { auctionId: id, status: "OPEN" }, select: { id: true, productId: true } });
    await tx.$queryRaw`SELECT id FROM auction_lots WHERE "auctionId" = ${id} AND status = 'OPEN' ORDER BY id FOR UPDATE`;
    const now = new Date();
    await tx.auctionLot.updateMany({ where: { auctionId: id, status: "OPEN" }, data: { status: "CANCELLED", closedAt: now } });
    await tx.product.updateMany({ where: { id: { in: open.map((l) => l.productId) }, auctionHoldId: id }, data: { auctionHoldId: null } });
    await tx.auction.update({ where: { id }, data: { status: "CANCELLED", closedAt: now } });
    await tx.$executeRaw`SELECT pg_notify(${auctionChannel(id)}, ${JSON.stringify({ auction: "CANCELLED" })})`;
    return { cancelledLots: open.length };
  });
  await audit({ action: "auction.cancel", ...ACTOR(ctx), entity: "Auction", entityId: id, data: res });
  return res;
}

// ─── Queries ────────────────────────────────────────────────────────────────

export type AdminLotRow = {
  id: string;
  lotNumber: number;
  productId: string;
  stockCode: number;
  title: string;
  thumb: string | null;
  listPrice: number;
  purchasePrice: number | null;
  startPrice: number;
  reservePrice: number | null;
  reserveMet: boolean | null;
  currentBid: number | null;
  nextMinimum: number;
  leadingMax: number | null;
  bidCount: number;
  closesAt: Date;
  extended: boolean;
  status: AuctionLotStatus;
  closedAt: Date | null;
  orderId: string | null;
  leader: { customerId: string; name: string; email: string; bidderNumber: number | null } | null;
};

export type AuctionAdmin = {
  id: string;
  type: AuctionType;
  status: AuctionStatus;
  title: string;
  slug: string;
  description: string | null;
  opensAt: Date;
  firstCloseAt: Date;
  gapSeconds: number;
  extendSeconds: number;
  payDays: number;
  incrementTable: IncrementTable;
  customIncrements: boolean;
  publishedAt: Date | null;
  closedAt: Date | null;
  lots: AdminLotRow[];
  stats: { bids: number; bidders: number; currentTotal: number; lotsAboveReserve: number };
};

const name = (c: { firstName: string | null; lastName: string | null; email: string }) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;

export async function getAuctionAdmin(ctx: ServiceContext, auctionId: string): Promise<AuctionAdmin> {
  const id = idSchema.parse(auctionId);
  const a = await db.auction.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw new ServiceError("NOT_FOUND", "Auction not found");
  const table = tableOrDefault(a.incrementTable);
  const [lots, bidders, bidCount, distinctBidders] = await Promise.all([
    db.auctionLot.findMany({
      where: { auctionId: id },
      orderBy: { lotNumber: "asc" },
      include: {
        product: { select: { stockCode: true, title: true, price: true, purchasePrice: true, images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true } } } },
        leader: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    db.auctionBidder.findMany({ where: { auctionId: id }, select: { customerId: true, number: true } }),
    db.bid.count({ where: { tenantId: ctx.tenantId, lot: { auctionId: id }, voidedAt: null } }),
    db.bid.findMany({ where: { tenantId: ctx.tenantId, lot: { auctionId: id }, voidedAt: null }, distinct: ["customerId"], select: { customerId: true } }),
  ]);
  const numberOf = new Map(bidders.map((b) => [b.customerId, b.number]));
  const rows: AdminLotRow[] = lots.map((l) => ({
    id: l.id,
    lotNumber: l.lotNumber,
    productId: l.productId,
    stockCode: l.product.stockCode,
    title: l.product.title,
    thumb: l.product.images[0] ? imageUrl(l.product.images[0].storageKey, "thumb") : null,
    listPrice: l.product.price,
    purchasePrice: l.product.purchasePrice,
    startPrice: l.startPrice,
    reservePrice: l.reservePrice,
    reserveMet: reserveMet(l.currentBid, l.reservePrice),
    currentBid: l.currentBid,
    nextMinimum: nextMinimum(l.currentBid, l.startPrice, table),
    leadingMax: l.leadingMax,
    bidCount: l.bidCount,
    closesAt: l.closesAt,
    extended: l.extended,
    status: l.status,
    closedAt: l.closedAt,
    orderId: l.orderId,
    leader: l.leader ? { customerId: l.leader.id, name: name(l.leader), email: l.leader.email, bidderNumber: numberOf.get(l.leader.id) ?? null } : null,
  }));
  const counted = rows.filter((r) => r.status === "OPEN" || r.status === "SOLD");
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    title: a.title,
    slug: a.slug,
    description: a.description,
    opensAt: a.opensAt,
    firstCloseAt: a.firstCloseAt,
    gapSeconds: a.gapSeconds,
    extendSeconds: a.extendSeconds,
    payDays: a.payDays,
    incrementTable: table,
    customIncrements: table !== DEFAULT_INCREMENT_TABLE,
    publishedAt: a.publishedAt,
    closedAt: a.closedAt,
    lots: rows,
    stats: {
      bids: bidCount,
      bidders: distinctBidders.length,
      currentTotal: counted.reduce((s, r) => s + (r.currentBid ?? 0), 0),
      lotsAboveReserve: counted.filter((r) => r.currentBid !== null && r.reserveMet !== false).length,
    },
  };
}

export type AuctionListItem = {
  id: string;
  title: string;
  slug: string;
  type: AuctionType;
  status: AuctionStatus;
  opensAt: Date;
  firstCloseAt: Date;
  lastCloseAt: Date | null;
  lots: number;
  bids: number;
  /** Sum of the current bids (open) / hammer prices (sold) of lots at or above reserve. */
  hammerTotal: number;
};

export async function listAuctionsAdmin(ctx: ServiceContext): Promise<AuctionListItem[]> {
  const auctions = await db.auction.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ firstCloseAt: "desc" }, { createdAt: "desc" }],
    take: 500,
    select: { id: true, title: true, slug: true, type: true, status: true, opensAt: true, firstCloseAt: true },
  });
  if (!auctions.length) return [];
  const ids = auctions.map((a) => a.id);
  const [lots, bids] = await Promise.all([
    db.auctionLot.findMany({ where: { auctionId: { in: ids }, status: { not: "CANCELLED" } }, select: { auctionId: true, closesAt: true, currentBid: true, reservePrice: true, status: true } }),
    db.$queryRaw<{ auctionId: string; n: bigint }[]>`
      SELECT l."auctionId", count(*) AS n FROM bids b JOIN auction_lots l ON l.id = b."lotId"
      WHERE l."auctionId" = ANY(${ids}::text[]) AND b."voidedAt" IS NULL GROUP BY l."auctionId"`,
  ]);
  const bidsBy = new Map(bids.map((b) => [b.auctionId, Number(b.n)]));
  return auctions.map((a) => {
    const mine = lots.filter((l) => l.auctionId === a.id);
    const last = mine.reduce<Date | null>((m, l) => (!m || l.closesAt > m ? l.closesAt : m), null);
    return {
      ...a,
      lastCloseAt: last,
      lots: mine.length,
      bids: bidsBy.get(a.id) ?? 0,
      hammerTotal: mine
        .filter((l) => (l.status === "OPEN" || l.status === "SOLD") && l.currentBid !== null && reserveMet(l.currentBid, l.reservePrice) !== false)
        .reduce((s, l) => s + (l.currentBid ?? 0), 0),
    };
  });
}

export type AuctionResultRow = {
  lot: { id: string; lotNumber: number; status: AuctionLotStatus; startPrice: number; reservePrice: number | null; bidCount: number; closedAt: Date | null };
  product: { id: string; stockCode: number; title: string; listPrice: number; purchasePrice: number | null; thumb: string | null };
  result: "SOLD" | "UNSOLD" | "CANCELLED" | "OPEN";
  hammer: number | null;
  winner: { customerId: string; name: string; email: string; bidderNumber: number | null } | null;
  order: { id: string; number: number; paymentStatus: PaymentStatus; paid: boolean; canceled: boolean } | null;
  daysSinceClose: number | null;
  /** Pay deadline (closedAt + payDays) for sold lots. */
  payBy: Date | null;
};

export async function getAuctionResults(ctx: ServiceContext, auctionId: string) {
  const id = idSchema.parse(auctionId);
  const a = await db.auction.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, title: true, status: true, payDays: true, closedAt: true } });
  if (!a) throw new ServiceError("NOT_FOUND", "Auction not found");
  const [lots, bidders] = await Promise.all([
    db.auctionLot.findMany({
      where: { auctionId: id },
      orderBy: { lotNumber: "asc" },
      include: {
        product: { select: { id: true, stockCode: true, title: true, price: true, purchasePrice: true, images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true } } } },
        leader: { select: { id: true, firstName: true, lastName: true, email: true } },
        order: { select: { id: true, number: true, paymentStatus: true, canceledAt: true } },
      },
    }),
    db.auctionBidder.findMany({ where: { auctionId: id }, select: { customerId: true, number: true } }),
  ]);
  const numberOf = new Map(bidders.map((b) => [b.customerId, b.number]));
  const now = Date.now();
  const rows: AuctionResultRow[] = lots.map((l) => {
    const sold = l.status === "SOLD" || (l.status === "CANCELLED" && !!l.orderId);
    return {
      lot: { id: l.id, lotNumber: l.lotNumber, status: l.status, startPrice: l.startPrice, reservePrice: l.reservePrice, bidCount: l.bidCount, closedAt: l.closedAt },
      product: {
        id: l.product.id,
        stockCode: l.product.stockCode,
        title: l.product.title,
        listPrice: l.product.price,
        purchasePrice: l.product.purchasePrice,
        thumb: l.product.images[0] ? imageUrl(l.product.images[0].storageKey, "thumb") : null,
      },
      result: l.status,
      hammer: l.status === "SOLD" || sold ? l.currentBid : null,
      winner: sold && l.leader ? { customerId: l.leader.id, name: name(l.leader), email: l.leader.email, bidderNumber: numberOf.get(l.leader.id) ?? null } : null,
      order: l.order
        ? { id: l.order.id, number: l.order.number, paymentStatus: l.order.paymentStatus, paid: l.order.paymentStatus === "PAID", canceled: !!l.order.canceledAt }
        : null,
      daysSinceClose: l.closedAt ? Math.floor((now - l.closedAt.getTime()) / DAY_MS) : null,
      payBy: l.status === "SOLD" && l.closedAt ? new Date(l.closedAt.getTime() + a.payDays * DAY_MS) : null,
    };
  });
  const soldRows = rows.filter((r) => r.result === "SOLD");
  return {
    auction: a,
    rows,
    totals: {
      lots: rows.length,
      sold: soldRows.length,
      unsold: rows.filter((r) => r.result === "UNSOLD").length,
      cancelled: rows.filter((r) => r.result === "CANCELLED").length,
      hammerTotal: soldRows.reduce((s, r) => s + (r.hammer ?? 0), 0),
      paidTotal: soldRows.filter((r) => r.order?.paid).reduce((s, r) => s + (r.hammer ?? 0), 0),
      unpaid: soldRows.filter((r) => !r.order?.paid).length,
    },
  };
}
export type AuctionResults = Awaited<ReturnType<typeof getAuctionResults>>;

/** Full bid list of a lot for staff (incl. maxima, voided rows and the bidder). */
export async function listLotBidsAdmin(ctx: ServiceContext, lotId: string) {
  const id = idSchema.parse(lotId);
  const lot = await db.auctionLot.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { auctionId: true } });
  if (!lot) throw new ServiceError("NOT_FOUND", "Lot not found");
  const [bids, bidders] = await Promise.all([
    db.bid.findMany({
      where: { lotId: id, tenantId: ctx.tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { customer: { select: { id: true, firstName: true, lastName: true, email: true } } },
      take: 1000,
    }),
    db.auctionBidder.findMany({ where: { auctionId: lot.auctionId }, select: { customerId: true, number: true } }),
  ]);
  const numberOf = new Map(bidders.map((b) => [b.customerId, b.number]));
  return bids.map((b) => ({
    id: b.id,
    amount: b.amount,
    maxAmount: b.maxAmount,
    isAuto: b.isAuto,
    createdAt: b.createdAt,
    voidedAt: b.voidedAt,
    voidReason: b.voidReason,
    customer: { customerId: b.customer.id, name: name(b.customer), email: b.customer.email, bidderNumber: numberOf.get(b.customer.id) ?? null },
  }));
}

// ─── Voiding bids ───────────────────────────────────────────────────────────

/**
 * Staff void a bidder's bid (their own submission, not an automatic counter-bid). The lot is recomputed
 * from the remaining submissions: every automatic row is voided ("recomputed") and the automatic rows of
 * the replay are written again at their original moments; submission rows get their recomputed amount.
 */
export async function voidBid(ctx: ServiceContext, bidId: string, reason: string) {
  const id = idSchema.parse(bidId);
  const why = parseInput(z.string().trim().min(2, "Give a reason").max(500), reason);
  const res = await db.$transaction(
    async (tx) => {
      const target = await tx.bid.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, lotId: true, isAuto: true, voidedAt: true, customerId: true } });
      if (!target) throw new ServiceError("NOT_FOUND", "Bid not found");
      const lot = await lockLotRow(tx, ctx.tenantId, target.lotId);
      if (target.voidedAt) throw new ServiceError("CONFLICT", "This bid is already voided");
      if (target.isAuto) throw new ServiceError("INVALID", "This is an automatic bid — void the bidder's own bid instead");
      if (lot.status !== "OPEN") throw new ServiceError("CONFLICT", "The lot is closed — cancel the won lot instead");
      const now = new Date();

      const before = { current: lot.currentBid, leaderId: lot.leadingBidderId };
      await tx.bid.update({ where: { id }, data: { voidedAt: now, voidedById: ctx.actor.id, voidReason: why } });
      await tx.bid.updateMany({ where: { lotId: lot.id, isAuto: true, voidedAt: null }, data: { voidedAt: now, voidedById: ctx.actor.id, voidReason: `Recomputed after a voided bid: ${why}`.slice(0, 500) } });
      const subs = await tx.bid.findMany({ where: { lotId: lot.id, isAuto: false, voidedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, customerId: true, maxAmount: true, createdAt: true } });
      const cfg = { startPrice: lot.startPrice, reservePrice: lot.reservePrice, table: tableOrDefault(lot.auction.incrementTable) };
      const replay = replayBids(subs, cfg);
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const steps = replay.stepsBySubmission[i];
        if (!steps.length) {
          await tx.bid.update({ where: { id: sub.id }, data: { voidedAt: now, voidedById: ctx.actor.id, voidReason: "No longer valid after recomputation" } });
          continue;
        }
        const own = steps.findIndex((s) => !s.isAuto && s.customerId === sub.customerId);
        if (own >= 0) await tx.bid.update({ where: { id: sub.id }, data: { amount: steps[own].amount } });
        const autos = steps.map((s, j) => ({ s, j })).filter(({ s }) => s.isAuto);
        if (autos.length) {
          await tx.bid.createMany({
            data: autos.map(({ s, j }) => ({
              tenantId: ctx.tenantId,
              lotId: lot.id,
              customerId: s.customerId,
              amount: s.amount,
              maxAmount: s.maxAmount,
              isAuto: true,
              createdAt: new Date(sub.createdAt.getTime() + (j - Math.max(own, 0))),
            })),
          });
        }
      }
      const bidCount = await tx.bid.count({ where: { lotId: lot.id, voidedAt: null } });
      await tx.auctionLot.update({
        where: { id: lot.id },
        data: { currentBid: replay.state.current, leadingBidderId: replay.state.leaderId, leadingMax: replay.state.leadingMax, bidCount },
      });
      await notifyLot(tx, lot.auctionId, lot.id);
      return { lotId: lot.id, before, after: { current: replay.state.current, leaderId: replay.state.leaderId }, voidedCustomerId: target.customerId };
    },
    { timeout: 20_000 },
  );
  await audit({ action: "auction.bid.void", ...ACTOR(ctx), entity: "AuctionLot", entityId: res.lotId, data: { bidId: id, reason: why, ...res } });
  return res;
}

// ─── Blocked bidders ────────────────────────────────────────────────────────

export async function blockBidder(ctx: ServiceContext, customerId: string, reason?: string | null) {
  const id = idSchema.parse(customerId);
  const why = reason ? z.string().trim().max(500).parse(reason) || null : null;
  const customer = await db.customer.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
  if (!customer) throw new ServiceError("NOT_FOUND", "Customer not found");
  await db.blockedBidder.upsert({
    where: { customerId: id },
    create: { tenantId: ctx.tenantId, customerId: id, reason: why, blockedBy: ctx.actor.id },
    update: { reason: why, blockedBy: ctx.actor.id },
  });
  await audit({ action: "auction.bidder.block", ...ACTOR(ctx), entity: "Customer", entityId: id, data: { reason: why } });
}

export async function unblockBidder(ctx: ServiceContext, customerId: string) {
  const id = idSchema.parse(customerId);
  const res = await db.blockedBidder.deleteMany({ where: { tenantId: ctx.tenantId, customerId: id } });
  if (res.count) await audit({ action: "auction.bidder.unblock", ...ACTOR(ctx), entity: "Customer", entityId: id });
  return { unblocked: res.count > 0 };
}

export async function listBlockedBidders(ctx: ServiceContext) {
  const rows = await db.blockedBidder.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { id: true, firstName: true, lastName: true, email: true } } },
    take: 1000,
  });
  return rows.map((r) => ({ customerId: r.customerId, name: name(r.customer), email: r.customer.email, reason: r.reason, blockedBy: r.blockedBy, createdAt: r.createdAt }));
}

export async function isBlockedBidder(tenantId: string, customerId: string): Promise<boolean> {
  return !!(await db.blockedBidder.findFirst({ where: { tenantId, customerId }, select: { id: true } }));
}

// ─── Signals ────────────────────────────────────────────────────────────────

export type BidSignalRow = {
  customers: { customerId: string; name: string; email: string; bidderNumber: number | null; blocked: boolean }[];
  sharedBy: "device" | "ip";
  lots: { lotId: string; lotNumber: number }[];
  /** Number of lots of this auction both bid on. */
  count: number;
};

/**
 * "Check this" box: pairs of different customers who share a device or IP hash (anywhere in this shop's
 * bids) and bid on the same lots of this auction. Device matches first; an IP match alone is weaker
 * (households, offices, mobile carriers).
 */
export async function getBidSignals(ctx: ServiceContext, auctionId: string): Promise<BidSignalRow[]> {
  const id = idSchema.parse(auctionId);
  const a = await db.auction.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
  if (!a) throw new ServiceError("NOT_FOUND", "Auction not found");
  const rows = await db.$queryRaw<{ c1: string; c2: string; kind: "device" | "ip"; lots: string[] }[]>`
    WITH a AS (
      SELECT DISTINCT b."customerId", b."lotId" FROM bids b JOIN auction_lots l ON l.id = b."lotId"
      WHERE l."auctionId" = ${id} AND b."tenantId" = ${ctx.tenantId} AND b."voidedAt" IS NULL AND NOT b."isAuto"
    ),
    pairs AS (
      SELECT x."customerId" AS c1, y."customerId" AS c2, x."lotId" FROM a x JOIN a y ON x."lotId" = y."lotId" AND x."customerId" < y."customerId"
    ),
    mine AS (
      SELECT DISTINCT b."customerId", b."deviceHash", b."ipHash" FROM bids b
      WHERE b."tenantId" = ${ctx.tenantId} AND b."customerId" IN (SELECT "customerId" FROM a) AND (b."deviceHash" IS NOT NULL OR b."ipHash" IS NOT NULL)
    ),
    shared AS (
      SELECT DISTINCT p.c1, p.c2, 'device' AS kind FROM (SELECT DISTINCT c1, c2 FROM pairs) p
        JOIN mine m1 ON m1."customerId" = p.c1 JOIN mine m2 ON m2."customerId" = p.c2 AND m1."deviceHash" = m2."deviceHash"
      UNION
      SELECT DISTINCT p.c1, p.c2, 'ip' AS kind FROM (SELECT DISTINCT c1, c2 FROM pairs) p
        JOIN mine m1 ON m1."customerId" = p.c1 JOIN mine m2 ON m2."customerId" = p.c2 AND m1."ipHash" = m2."ipHash"
    )
    SELECT s.c1, s.c2, s.kind, array_agg(DISTINCT pr."lotId") AS lots
    FROM shared s JOIN pairs pr ON pr.c1 = s.c1 AND pr.c2 = s.c2
    GROUP BY s.c1, s.c2, s.kind`;
  if (!rows.length) return [];
  // One row per pair: a device match outranks an IP match.
  const byPair = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = `${r.c1}:${r.c2}`;
    const prev = byPair.get(key);
    if (!prev || (prev.kind === "ip" && r.kind === "device")) byPair.set(key, r);
  }
  const pairs = [...byPair.values()];
  const customerIds = [...new Set(pairs.flatMap((p) => [p.c1, p.c2]))];
  const lotIds = [...new Set(pairs.flatMap((p) => p.lots))];
  const [customers, bidders, lots, blocked] = await Promise.all([
    db.customer.findMany({ where: { id: { in: customerIds }, tenantId: ctx.tenantId }, select: { id: true, firstName: true, lastName: true, email: true } }),
    db.auctionBidder.findMany({ where: { auctionId: id, customerId: { in: customerIds } }, select: { customerId: true, number: true } }),
    db.auctionLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, lotNumber: true } }),
    db.blockedBidder.findMany({ where: { tenantId: ctx.tenantId, customerId: { in: customerIds } }, select: { customerId: true } }),
  ]);
  const c = new Map(customers.map((x) => [x.id, x]));
  const n = new Map(bidders.map((x) => [x.customerId, x.number]));
  const l = new Map(lots.map((x) => [x.id, x.lotNumber]));
  const b = new Set(blocked.map((x) => x.customerId));
  return pairs
    .map((p) => ({
      customers: [p.c1, p.c2].map((cid) => ({ customerId: cid, name: c.get(cid) ? name(c.get(cid)!) : "?", email: c.get(cid)?.email ?? "", bidderNumber: n.get(cid) ?? null, blocked: b.has(cid) })),
      sharedBy: p.kind,
      lots: p.lots.map((lotId) => ({ lotId, lotNumber: l.get(lotId) ?? 0 })).sort((x, y) => x.lotNumber - y.lotNumber),
      count: p.lots.length,
    }))
    .sort((x, y) => (x.sharedBy === y.sharedBy ? y.count - x.count : x.sharedBy === "device" ? -1 : 1));
}

// ─── Won lots ───────────────────────────────────────────────────────────────

/**
 * The winner didn't pay (or the sale is undone before payment): cancels the order through the normal
 * order cancel path, sets the lot CANCELLED and puts the product back in the shop. Optionally blocks
 * the bidder. Paid orders can't be cancelled here (CONFLICT from cancelOrder).
 */
export async function cancelWonLot(ctx: ServiceContext, lotId: string, opts: { blockBidder?: boolean; reason?: string | null } = {}) {
  const id = idSchema.parse(lotId);
  const lot = await db.auctionLot.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, status: true, orderId: true, leadingBidderId: true, lotNumber: true, auctionId: true, order: { select: { canceledAt: true } } } });
  if (!lot) throw new ServiceError("NOT_FOUND", "Lot not found");
  if (lot.status !== "SOLD" || !lot.orderId) throw new ServiceError("CONFLICT", "Only a won lot can be cancelled here");
  const reason = opts.reason?.trim() || `Auction lot ${lot.lotNumber} not paid`;
  if (!lot.order?.canceledAt) await cancelOrder(ctx, lot.orderId, reason);
  await db.$transaction(async (tx) => {
    const locked = await lockLotRow(tx, ctx.tenantId, id);
    if (locked.status !== "SOLD") return;
    await tx.auctionLot.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.product.updateMany({ where: { id: locked.productId, auctionHoldId: locked.auctionId }, data: { auctionHoldId: null } });
    await notifyLot(tx, locked.auctionId, id);
  });
  if (opts.blockBidder && lot.leadingBidderId) await blockBidder(ctx, lot.leadingBidderId, reason);
  await audit({ action: "auction.lot.cancel", ...ACTOR(ctx), entity: "AuctionLot", entityId: id, data: { orderId: lot.orderId, blocked: !!opts.blockBidder, reason } });
}

/** Sends the payment reminder mail again (won lot, unpaid). */
export async function sendPaymentReminder(ctx: ServiceContext, lotId: string) {
  const id = idSchema.parse(lotId);
  const lot = await db.auctionLot.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { status: true, order: { select: { paymentStatus: true, canceledAt: true, finalizedAt: true } } } });
  if (!lot) throw new ServiceError("NOT_FOUND", "Lot not found");
  if (lot.status !== "SOLD" || !lot.order || lot.order.canceledAt) throw new ServiceError("CONFLICT", "This lot has no open payment");
  if (lot.order.finalizedAt || lot.order.paymentStatus === "PAID") throw new ServiceError("CONFLICT", "This lot is already paid");
  await queueMail({ tenantId: ctx.tenantId, template: "auction-payment-reminder", props: { lotId: id } });
  await audit({ action: "auction.lot.reminder", ...ACTOR(ctx), entity: "AuctionLot", entityId: id });
}
