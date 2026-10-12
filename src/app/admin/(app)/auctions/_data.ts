import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { imageUrl } from "@/server/media/product-images";
import type { AuctionStatus, AuctionLotStatus, PaymentStatus, ProductStatus } from "@/generated/prisma/enums";

/*
 * Read helpers for the auction admin screens that the engine service (src/server/auctions) does
 * not offer: the lot picker search, the review-bids list, the customer history card and the
 * product-editor notice. Raw db reads, always scoped by ctx.tenantId.
 */

const id = z.string().min(1).max(64);
const RUNNING: AuctionStatus[] = ["DRAFT", "PUBLISHED", "LIVE"];

export type LotCandidate = {
  id: string;
  stockCode: number;
  title: string;
  price: number;
  thumb: string | null;
  /** Why it can't be added; null = can be added. */
  blocker:
    | { kind: "notActive"; status: ProductStatus }
    | { kind: "noStock" }
    | { kind: "onFair" }
    | { kind: "inCart" }
    | { kind: "inThis" }
    | { kind: "inAuction"; auctionId: string; title: string }
    | null;
};

/**
 * Lot picker search. Lists matching items of any status (newest first) with the reason the ones
 * that can't become a lot are blocked, so the dealer sees why an item is missing. Addable first.
 * `auctionId` null = picking the item of a new single-lot auction.
 */
export async function searchLotCandidates(ctx: ServiceContext, auctionId: string | null, q: string, limit = 40): Promise<LotCandidate[]> {
  const query = z.string().trim().max(100).parse(q ?? "");
  const thisId = auctionId ? id.parse(auctionId) : null;
  const code = /^\d{1,9}$/.test(query) ? Number(query) : null;
  const rows = await db.product.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: query ? { in: ["ACTIVE", "DRAFT", "RESERVED"] } : "ACTIVE",
      ...(query
        ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }, ...(code ? [{ stockCode: code }] : [])] }
        : {}),
    },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { stockCode: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      stockCode: true,
      title: true,
      price: true,
      status: true,
      quantity: true,
      fairHoldId: true,
      images: { select: { storageKey: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1 },
      reservations: { where: { status: "ACTIVE", expiresAt: { gt: new Date() } }, select: { id: true }, take: 1 },
      auctionLots: {
        where: { tenantId: ctx.tenantId, status: { in: ["OPEN", "SOLD"] }, auction: { status: { in: RUNNING } } },
        select: { auctionId: true, auction: { select: { title: true } } },
        take: 1,
      },
    },
  });
  const out = rows.map((r): LotCandidate => {
    const lot = r.auctionLots[0];
    const blocker: LotCandidate["blocker"] =
      lot && lot.auctionId === thisId
        ? { kind: "inThis" }
        : lot
          ? { kind: "inAuction", auctionId: lot.auctionId, title: lot.auction.title }
          : r.status !== "ACTIVE"
            ? { kind: "notActive", status: r.status }
            : r.quantity <= 0
              ? { kind: "noStock" }
              : r.fairHoldId
                ? { kind: "onFair" }
                : r.reservations.length
                  ? { kind: "inCart" }
                  : null;
    return { id: r.id, stockCode: r.stockCode, title: r.title, price: r.price, thumb: r.images[0] ? imageUrl(r.images[0].storageKey, "thumb") : null, blocker };
  });
  return out.sort((a, b) => Number(a.blocker !== null) - Number(b.blocker !== null));
}

export type ReviewBid = {
  id: string;
  lotId: string;
  lotNumber: number;
  title: string;
  customerId: string;
  bidderNumber: number | null;
  name: string;
  amount: number;
  maxAmount: number;
  isAuto: boolean;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
};

/** Bids of `customerIds` on the auction's lots (optionally only `lotIds`), newest first — for "Review bids". */
export async function listBidsForReview(ctx: ServiceContext, auctionId: string, customerIds: string[], lotIds?: string[]): Promise<ReviewBid[]> {
  const aid = id.parse(auctionId);
  const customers = z.array(id).max(20).parse(customerIds);
  const lots = lotIds ? z.array(id).max(500).parse(lotIds) : undefined;
  if (!customers.length) return [];
  const [bids, numbers] = await Promise.all([
    db.bid.findMany({
      where: { tenantId: ctx.tenantId, customerId: { in: customers }, lot: { auctionId: aid }, ...(lots?.length ? { lotId: { in: lots } } : {}) },
      orderBy: [{ createdAt: "desc" }],
      take: 300,
      select: {
        id: true,
        lotId: true,
        customerId: true,
        amount: true,
        maxAmount: true,
        isAuto: true,
        createdAt: true,
        voidedAt: true,
        voidReason: true,
        lot: { select: { lotNumber: true, product: { select: { title: true } } } },
        customer: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    db.auctionBidder.findMany({ where: { tenantId: ctx.tenantId, auctionId: aid, customerId: { in: customers } }, select: { customerId: true, number: true } }),
  ]);
  const num = new Map(numbers.map((n) => [n.customerId, n.number]));
  return bids.map((b) => ({
    id: b.id,
    lotId: b.lotId,
    lotNumber: b.lot.lotNumber,
    title: b.lot.product.title,
    customerId: b.customerId,
    bidderNumber: num.get(b.customerId) ?? null,
    name: [b.customer.firstName, b.customer.lastName].filter(Boolean).join(" ") || b.customer.email,
    amount: b.amount,
    maxAmount: b.maxAmount,
    isAuto: b.isAuto,
    createdAt: b.createdAt,
    voidedAt: b.voidedAt,
    voidReason: b.voidReason,
  }));
}

export type CustomerAuctionLot = {
  lotId: string;
  lotNumber: number;
  auctionId: string;
  auctionTitle: string;
  title: string;
  bids: number;
  lotStatus: AuctionLotStatus;
  leading: boolean;
  won: boolean;
  paid: boolean;
  orderId: string | null;
};

export type CustomerAuctionSummary = {
  blocked: { reason: string | null; createdAt: Date } | null;
  lots: CustomerAuctionLot[];
};

/** Block state + the lots this customer bid on (latest 25 lots), for the customer page. */
export async function getCustomerAuctionSummary(ctx: ServiceContext, customerId: string): Promise<CustomerAuctionSummary> {
  const cid = id.parse(customerId);
  const [blocked, grouped] = await Promise.all([
    db.blockedBidder.findFirst({ where: { tenantId: ctx.tenantId, customerId: cid }, select: { reason: true, createdAt: true } }),
    db.bid.groupBy({
      by: ["lotId"],
      where: { tenantId: ctx.tenantId, customerId: cid, voidedAt: null },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: 25,
    }),
  ]);
  if (!grouped.length) return { blocked, lots: [] };
  const lots = await db.auctionLot.findMany({
    where: { tenantId: ctx.tenantId, id: { in: grouped.map((g) => g.lotId) } },
    select: {
      id: true,
      lotNumber: true,
      status: true,
      leadingBidderId: true,
      orderId: true,
      auction: { select: { id: true, title: true } },
      product: { select: { title: true } },
      order: { select: { paymentStatus: true } },
    },
  });
  const byId = new Map(lots.map((l) => [l.id, l]));
  const paidStatuses: PaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
  return {
    blocked,
    lots: grouped.flatMap((g) => {
      const l = byId.get(g.lotId);
      if (!l) return [];
      const leading = l.leadingBidderId === cid;
      const won = l.status === "SOLD" && leading;
      return [
        {
          lotId: l.id,
          lotNumber: l.lotNumber,
          auctionId: l.auction.id,
          auctionTitle: l.auction.title,
          title: l.product.title,
          bids: g._count._all,
          lotStatus: l.status,
          leading: l.status === "OPEN" && leading,
          won,
          paid: won && !!l.order && paidStatuses.includes(l.order.paymentStatus),
          orderId: won ? l.orderId : null,
        },
      ];
    }),
  };
}

/** The upcoming / live auction this product is a lot in (for the product editor notice), or null. */
export async function getProductAuctionLot(ctx: ServiceContext, productId: string) {
  const pid = id.parse(productId);
  return db.auctionLot.findFirst({
    where: { tenantId: ctx.tenantId, productId: pid, status: "OPEN", auction: { status: { in: RUNNING } } },
    orderBy: { createdAt: "desc" },
    select: { lotNumber: true, auction: { select: { id: true, title: true, status: true } } },
  });
}
