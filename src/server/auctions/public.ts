import "server-only";
import { db } from "@/server/db";
import { assertModule, hasModule } from "@/server/modules";
import type { Prisma } from "@/generated/prisma/client";
import type { AuctionLotStatus, AuctionStatus, AuctionType } from "@/generated/prisma/enums";
import { nextMinimum, tableOrDefault } from "./increments";
import { reserveMet, visibleHistory } from "./engine";
import type { Tx } from "./shared";

/*
 * Public (shop) reads of auctions (docs/auctions.md). Never exposes maxAmount, leadingMax, the reserve
 * amount or customer ids — bidders appear as their per-auction number ("Bidder 7").
 * Visible auctions: PUBLISHED, LIVE and CLOSED (DRAFT and CANCELLED are not public).
 */

const PUBLIC_STATUSES: AuctionStatus[] = ["PUBLISHED", "LIVE", "CLOSED"];

export type PublicLot = {
  id: string;
  auctionId: string;
  lotNumber: number;
  productId: string;
  stockCode: number;
  title: string;
  slug: string;
  /** Storage key of the cover image (render with imageUrl(key, variant)); null without images. */
  coverKey: string | null;
  startPrice: number;
  currentBid: number | null;
  nextMinimum: number;
  bidCount: number;
  /** ISO. Moves forward with late-bid extensions. */
  closesAt: string;
  extended: boolean;
  status: AuctionLotStatus;
  /** null when the lot has no reserve. */
  reserveMet: boolean | null;
  leaderNumber: number | null;
  // ── additive (beyond the contract) ──
  /** status !== OPEN, or OPEN but closesAt has passed (the closing job runs every few seconds). */
  closed: boolean;
  /** Sensitive item (blurred for guests, like the product page). */
  blurred: boolean;
  /** Age-restricted item: bidding may require the age confirmation (placeBid ageConfirmed). */
  ageRestricted: boolean;
  /** List price of the product (reference). */
  listPrice: number;
};

export type PublicBid = { bidderNumber: number; amount: number; isAuto: boolean; at: string };

export type AuctionSummary = {
  id: string;
  type: AuctionType;
  status: AuctionStatus;
  title: string;
  slug: string;
  /** ISO */
  opensAt: string;
  /** ISO — first lot's scheduled close (SINGLE: the lot's). */
  firstCloseAt: string;
  // ── additive ──
  /** ISO — the latest (current) close of any lot; null without lots. */
  lastCloseAt: string | null;
  lotCount: number;
  coverKey: string | null;
};

export type PublicAuction = {
  id: string;
  type: AuctionType;
  status: AuctionStatus;
  title: string;
  slug: string;
  description: string | null;
  opensAt: string;
  firstCloseAt: string;
  gapSeconds: number;
  extendSeconds: number;
  lots: PublicLot[];
  // ── additive ──
  payDays: number;
  /** Server time (ISO) of this snapshot, for client clock sync. */
  serverTime: string;
};

const coverSelect = { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }], take: 1, select: { storageKey: true } };

export const lotPublicSelect = {
  id: true,
  auctionId: true,
  lotNumber: true,
  productId: true,
  startPrice: true,
  reservePrice: true,
  closesAt: true,
  extended: true,
  currentBid: true,
  leadingBidderId: true,
  bidCount: true,
  status: true,
  product: { select: { stockCode: true, title: true, slug: true, price: true, blurred: true, ageRestricted: true, images: coverSelect } },
  auction: { select: { incrementTable: true } },
} satisfies Prisma.AuctionLotSelect;

type LotRow = Prisma.AuctionLotGetPayload<{ select: typeof lotPublicSelect }>;

/** Bidder numbers of the given customers in one auction. */
async function bidderNumbers(client: Tx | typeof db, auctionIds: string[], customerIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(customerIds)].filter(Boolean);
  if (!ids.length || !auctionIds.length) return new Map();
  const rows = await client.auctionBidder.findMany({
    where: { auctionId: { in: [...new Set(auctionIds)] }, customerId: { in: ids } },
    select: { auctionId: true, customerId: true, number: true },
  });
  return new Map(rows.map((r) => [`${r.auctionId}:${r.customerId}`, r.number]));
}

function toPublicLot(l: LotRow, numbers: Map<string, number>, now: Date): PublicLot {
  const table = tableOrDefault(l.auction.incrementTable);
  return {
    id: l.id,
    auctionId: l.auctionId,
    lotNumber: l.lotNumber,
    productId: l.productId,
    stockCode: l.product.stockCode,
    title: l.product.title,
    slug: l.product.slug,
    coverKey: l.product.images[0]?.storageKey ?? null,
    startPrice: l.startPrice,
    currentBid: l.currentBid,
    nextMinimum: nextMinimum(l.currentBid, l.startPrice, table),
    bidCount: l.bidCount,
    closesAt: l.closesAt.toISOString(),
    extended: l.extended,
    status: l.status,
    reserveMet: reserveMet(l.currentBid, l.reservePrice),
    leaderNumber: l.leadingBidderId ? (numbers.get(`${l.auctionId}:${l.leadingBidderId}`) ?? null) : null,
    closed: l.status !== "OPEN" || l.closesAt.getTime() <= now.getTime(),
    blurred: l.product.blurred,
    ageRestricted: l.product.ageRestricted,
    listPrice: l.product.price,
  };
}

/** PublicLot rows for `where` (tenant-scoped by the caller), ordered by lot number. */
export async function loadPublicLots(where: Prisma.AuctionLotWhereInput, client: Tx | typeof db = db, now = new Date()): Promise<PublicLot[]> {
  const rows = await client.auctionLot.findMany({ where, orderBy: [{ auctionId: "asc" }, { lotNumber: "asc" }], select: lotPublicSelect });
  const numbers = await bidderNumbers(
    client,
    rows.map((r) => r.auctionId),
    rows.map((r) => r.leadingBidderId).filter((id): id is string => !!id),
  );
  return rows.map((r) => toPublicLot(r, numbers, now));
}

/** One lot's public state (tenant-scoped). Null when missing or its auction isn't public. */
export async function loadPublicLot(tenantId: string, lotId: string, client: Tx | typeof db = db): Promise<PublicLot | null> {
  const [lot] = await loadPublicLots({ id: lotId, tenantId, auction: { status: { in: PUBLIC_STATUSES } } }, client);
  return lot ?? null;
}

const summarySelect = {
  id: true,
  type: true,
  status: true,
  title: true,
  slug: true,
  opensAt: true,
  firstCloseAt: true,
  _count: { select: { lots: { where: { status: { not: "CANCELLED" } } } } },
  lots: {
    where: { status: { not: "CANCELLED" } },
    orderBy: { lotNumber: "asc" },
    take: 1,
    select: { product: { select: { images: coverSelect } } },
  },
} satisfies Prisma.AuctionSelect;

type SummaryRow = Prisma.AuctionGetPayload<{ select: typeof summarySelect }>;

async function toSummaries(rows: SummaryRow[]): Promise<AuctionSummary[]> {
  if (!rows.length) return [];
  const last = await db.auctionLot.groupBy({ by: ["auctionId"], where: { auctionId: { in: rows.map((r) => r.id) }, status: { not: "CANCELLED" } }, _max: { closesAt: true } });
  const lastBy = new Map(last.map((l) => [l.auctionId, l._max.closesAt]));
  return rows.map((a) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    title: a.title,
    slug: a.slug,
    opensAt: a.opensAt.toISOString(),
    firstCloseAt: a.firstCloseAt.toISOString(),
    lastCloseAt: lastBy.get(a.id)?.toISOString() ?? null,
    lotCount: a._count.lots,
    coverKey: a.lots[0]?.product.images[0]?.storageKey ?? null,
  }));
}

/** Public auction page by slug (lots ordered by lot number, cancelled lots left out). */
export async function getPublicAuction(tenantId: string, slug: string): Promise<PublicAuction | null> {
  await assertModule({ tenantId }, "auctions");
  return loadPublicAuction(tenantId, slug);
}

async function loadPublicAuction(tenantId: string, slug: string): Promise<PublicAuction | null> {
  const a = await db.auction.findFirst({
    where: { tenantId, slug: String(slug ?? "").slice(0, 200), status: { in: PUBLIC_STATUSES } },
    select: { id: true, type: true, status: true, title: true, slug: true, description: true, opensAt: true, firstCloseAt: true, gapSeconds: true, extendSeconds: true, payDays: true },
  });
  if (!a) return null;
  const now = new Date();
  const lots = await loadPublicLots({ tenantId, auctionId: a.id, status: { not: "CANCELLED" } }, db, now);
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    title: a.title,
    slug: a.slug,
    description: a.description,
    opensAt: a.opensAt.toISOString(),
    firstCloseAt: a.firstCloseAt.toISOString(),
    gapSeconds: a.gapSeconds,
    extendSeconds: a.extendSeconds,
    lots,
    payDays: a.payDays,
    serverTime: now.toISOString(),
  };
}

/** Public auction by id (same as getPublicAuction) — for the SSE/JSON endpoints. */
export async function getPublicAuctionById(tenantId: string, auctionId: string): Promise<PublicAuction | null> {
  await assertModule({ tenantId }, "auctions");
  const a = await db.auction.findFirst({ where: { id: String(auctionId ?? "").slice(0, 64), tenantId, status: { in: PUBLIC_STATUSES } }, select: { slug: true } });
  return a ? loadPublicAuction(tenantId, a.slug) : null;
}

/**
 * Auction overview: live auction days, upcoming (published, not open yet — both types) and the open
 * lots of live single-lot auctions (soonest close first).
 */
export async function listPublicAuctions(tenantId: string): Promise<{ live: AuctionSummary[]; upcoming: AuctionSummary[]; singles: PublicLot[] }> {
  await assertModule({ tenantId }, "auctions");
  const [live, upcoming] = await Promise.all([
    db.auction.findMany({ where: { tenantId, status: "LIVE", type: "DAY" }, orderBy: [{ firstCloseAt: "asc" }], select: summarySelect, take: 50 }),
    db.auction.findMany({ where: { tenantId, status: "PUBLISHED" }, orderBy: [{ opensAt: "asc" }], select: summarySelect, take: 50 }),
  ]);
  const singles = await loadPublicLots({ tenantId, status: "OPEN", auction: { status: "LIVE", type: "SINGLE" } });
  singles.sort((a, b) => a.closesAt.localeCompare(b.closesAt));
  return { live: await toSummaries(live), upcoming: await toSummaries(upcoming), singles };
}

/** Lot page: the lot, its auction and the latest 50 visible bids (newest first). */
export async function getPublicLot(tenantId: string, lotId: string): Promise<(PublicLot & { auction: AuctionSummary; history: PublicBid[] }) | null> {
  await assertModule({ tenantId }, "auctions");
  const lot = await loadPublicLot(tenantId, String(lotId ?? "").slice(0, 64));
  if (!lot) return null;
  const [auctionRow, history] = await Promise.all([
    db.auction.findUniqueOrThrow({ where: { id: lot.auctionId }, select: summarySelect }),
    lotHistory(tenantId, lot.auctionId, lot.id, 50),
  ]);
  const [auction] = await toSummaries([auctionRow]);
  return { ...lot, auction, history };
}

/** Visible bid history of a lot, newest first (voided bids left out, a leader's own raises collapsed). */
export async function lotHistory(tenantId: string, auctionId: string, lotId: string, limit = 50): Promise<PublicBid[]> {
  const rows = await db.bid.findMany({
    where: { tenantId, lotId, voidedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { customerId: true, amount: true, isAuto: true, createdAt: true },
    take: 2000,
  });
  const visible = visibleHistory(rows);
  const numbers = await bidderNumbers(db, [auctionId], visible.map((r) => r.customerId));
  return visible
    .slice(-limit)
    .reverse()
    .map((r) => ({ bidderNumber: numbers.get(`${auctionId}:${r.customerId}`) ?? 0, amount: r.amount, isAuto: r.isAuto, at: r.createdAt.toISOString() }));
}

/** The signed-in customer's position on a lot. */
export async function getMyLotState(
  tenantId: string,
  lotId: string,
  customerId: string,
): Promise<{ isLeading: boolean; myMax: number | null; outbid: boolean; bidderNumber: number | null; termsAccepted: boolean }> {
  const lot = await db.auctionLot.findFirst({ where: { id: String(lotId ?? "").slice(0, 64), tenantId }, select: { auctionId: true, leadingBidderId: true, leadingMax: true } });
  if (!lot || !customerId) return { isLeading: false, myMax: null, outbid: false, bidderNumber: null, termsAccepted: false };
  const [bidder, mine] = await Promise.all([
    db.auctionBidder.findUnique({ where: { auctionId_customerId: { auctionId: lot.auctionId, customerId } }, select: { number: true, termsAcceptedAt: true } }),
    db.bid.aggregate({ where: { tenantId, lotId, customerId, voidedAt: null }, _max: { maxAmount: true } }),
  ]);
  const isLeading = lot.leadingBidderId === customerId;
  const myMax = isLeading ? lot.leadingMax : (mine._max.maxAmount ?? null);
  return { isLeading, myMax, outbid: !isLeading && myMax !== null, bidderNumber: bidder?.number ?? null, termsAccepted: !!bidder?.termsAcceptedAt };
}

/**
 * The auction lot a product currently is (PUBLISHED/LIVE auction, lot OPEN) — the product page links to it.
 * Null without the auctions module (no throw: the product page must keep rendering).
 */
export async function lotForProduct(
  tenantId: string,
  productId: string,
): Promise<{ lotId: string; auctionId: string; auctionSlug: string; auctionTitle: string; lotNumber: number; closesAt: string; opensAt: string; status: AuctionStatus } | null> {
  if (!(await hasModule(tenantId, "auctions"))) return null;
  const lot = await db.auctionLot.findFirst({
    where: { tenantId, productId, status: "OPEN", auction: { status: { in: ["PUBLISHED", "LIVE"] } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, lotNumber: true, closesAt: true, auction: { select: { id: true, slug: true, title: true, opensAt: true, status: true } } },
  });
  if (!lot) return null;
  return {
    lotId: lot.id,
    auctionId: lot.auction.id,
    auctionSlug: lot.auction.slug,
    auctionTitle: lot.auction.title,
    lotNumber: lot.lotNumber,
    closesAt: lot.closesAt.toISOString(),
    opensAt: lot.auction.opensAt.toISOString(),
    status: lot.auction.status,
  };
}
