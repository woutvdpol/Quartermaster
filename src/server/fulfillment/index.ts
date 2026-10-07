import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import { packingSlipData, setFulfillmentStatus, type FulfillmentInput } from "@/server/orders/commands";
import { queueMail } from "@/server/mail";
import type { Prisma } from "@/generated/prisma/client";
import type { FulfillmentStatus } from "@/generated/prisma/enums";
import { trackingUrlFor } from "./carriers";

export { CARRIERS, findCarrier, trackingUrlFor, type CarrierPreset } from "./carriers";

/*
 * Fulfillment service: the shipping board and the order page go through here instead of calling
 * orders `setFulfillmentStatus` directly, so the customer's "shipped" mail is sent consistently.
 *
 * "Shipped" mail — exactly once per transition into SHIPPED:
 *   setFulfillmentStatus (own transaction, row lock) writes a `fulfillment.shipped` event whose data
 *   carries `from`. A *transition* is such an event with `from` not SHIPPED/DELIVERED. Afterwards
 *   `queueShippedMailOnce` locks the order row again and, in one transaction, writes a
 *   `shipped_mail_queued` event pointing at that transition event and queues the mail. Because both
 *   the claim and the job insert commit together under the row lock, duplicate clicks, concurrent
 *   requests and retries after a crash all end with exactly one mail per transition. Re-saving
 *   tracking info on an already shipped order is not a transition, but if the first save opted out
 *   of the notification, a later save with "notify" still sends it (once).
 */

const idSchema = z.string().trim().min(1).max(64);
type Tx = Prisma.TransactionClient;

export const SHIPPED_MAIL_EVENT = "shipped_mail_queued";

export type UpdateFulfillmentInput = FulfillmentInput & {
  /** Queue the "shipped" mail when this moves the order into SHIPPED (default true). */
  notifyCustomer?: boolean;
};

export type UpdateFulfillmentResult = { from: FulfillmentStatus; to: FulfillmentStatus; mailQueued: boolean };

/**
 * Sets the fulfillment status (+ carrier/tracking) and sends the "shipped" mail once per shipment.
 * When the carrier is a preset and no tracking URL is given, the URL is derived from the template.
 */
export async function updateFulfillment(ctx: ServiceContext, orderId: string, input: UpdateFulfillmentInput): Promise<UpdateFulfillmentResult> {
  const id = idSchema.parse(orderId);
  const { notifyCustomer = true, ...rest } = input;
  let trackingUrl = rest.trackingUrl;
  if (!trackingUrl && rest.carrier && rest.trackingNumber) {
    const dest = await db.orderAddress.findFirst({
      where: { tenantId: ctx.tenantId, orderId: id, type: "SHIPPING" },
      select: { postalCode: true, countryCode: true },
    });
    trackingUrl = trackingUrlFor(rest.carrier, rest.trackingNumber, dest ?? {}) ?? trackingUrl;
  }
  const result = await setFulfillmentStatus(ctx, id, { ...rest, trackingUrl });
  let mailQueued = false;
  if (notifyCustomer && result.to === "SHIPPED") mailQueued = await queueShippedMailOnce(ctx.tenantId, id);
  return { from: result.from as FulfillmentStatus, to: result.to as FulfillmentStatus, mailQueued };
}

/**
 * Queues the OrderShipped mail for the order's latest transition into SHIPPED, unless that
 * transition already has one. Returns true when a mail was queued now. Safe to call repeatedly.
 */
export async function queueShippedMailOnce(tenantId: string, orderId: string, opts: { tx?: Tx } = {}): Promise<boolean> {
  const run = async (tx: Tx) => {
    const rows = await tx.$queryRaw<{ fulfillmentStatus: FulfillmentStatus }[]>`
      SELECT "fulfillmentStatus" FROM orders WHERE id = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (rows.length === 0) throw new ServiceError("NOT_FOUND", "Order not found");
    if (rows[0].fulfillmentStatus !== "SHIPPED") return false;

    const shippedEvents = await tx.orderEvent.findMany({
      where: { tenantId, orderId, type: "fulfillment.shipped" },
      orderBy: { id: "desc" },
      select: { id: true, data: true },
      take: 50,
    });
    const transition = shippedEvents.find((e) => {
      const from = (e.data as { from?: unknown } | null)?.from;
      return from !== "SHIPPED" && from !== "DELIVERED";
    });
    if (!transition) return false;
    const key = transition.id.toString();

    const claims = await tx.orderEvent.findMany({
      where: { tenantId, orderId, type: SHIPPED_MAIL_EVENT, id: { gt: transition.id } },
      select: { data: true },
    });
    if (claims.some((c) => (c.data as { forEventId?: unknown } | null)?.forEventId === key)) return false;

    await tx.orderEvent.create({ data: { tenantId, orderId, type: SHIPPED_MAIL_EVENT, data: { forEventId: key } } });
    await queueMail({ tenantId, template: "order-shipped", props: { orderId } }, { tx });
    return true;
  };
  return opts.tx ? run(opts.tx) : db.$transaction(run);
}

// ─── Shipping board ─────────────────────────────────────────────────────────

export const SHIPPED_LANE_DAYS = 14;
const LANE_LIMIT = 150;

const cardSelect = {
  id: true,
  number: true,
  placedAt: true,
  paidAt: true,
  shippedAt: true,
  deliveredAt: true,
  customerName: true,
  email: true,
  currency: true,
  total: true,
  paymentStatus: true,
  paymentMethod: true,
  fulfillmentStatus: true,
  shippingMethod: true,
  shippingZoneName: true,
  carrier: true,
  trackingNumber: true,
  trackingUrl: true,
  _count: { select: { lines: true } },
  addresses: { where: { type: "SHIPPING" }, select: { countryCode: true, postalCode: true, city: true } },
} satisfies Prisma.OrderSelect;

type CardRow = Prisma.OrderGetPayload<{ select: typeof cardSelect }>;

function toCard({ _count, addresses, ...o }: CardRow) {
  return { ...o, lineCount: _count.lines, shipTo: addresses[0] ?? null };
}
export type BoardCard = ReturnType<typeof toCard>;

export type BoardLane = { cards: BoardCard[]; total: number };
export type ShippingBoard = {
  awaiting: BoardLane;
  toPack: BoardLane;
  packed: BoardLane;
  shipped: BoardLane;
  shippedSince: Date;
};

/**
 * The four lanes of the shipping board (non-archived orders only):
 *   awaiting – payment PENDING (not canceled), oldest first
 *   toPack   – PAID + UNFULFILLED, oldest paid first
 *   packed   – PAID + PACKED, oldest paid first
 *   shipped  – SHIPPED/DELIVERED with shippedAt in the last 14 days, newest first
 * Uses the (tenantId, paymentStatus, placedAt) and (tenantId, fulfillmentStatus) indexes.
 */
export async function getShippingBoard(ctx: ServiceContext, now = new Date()): Promise<ShippingBoard> {
  const tenantId = ctx.tenantId;
  const shippedSince = new Date(now.getTime() - SHIPPED_LANE_DAYS * 24 * 60 * 60 * 1000);
  const where = {
    awaiting: { tenantId, archivedAt: null, canceledAt: null, paymentStatus: "PENDING" },
    toPack: { tenantId, archivedAt: null, paymentStatus: "PAID", fulfillmentStatus: "UNFULFILLED" },
    packed: { tenantId, archivedAt: null, paymentStatus: "PAID", fulfillmentStatus: "PACKED" },
    shipped: { tenantId, archivedAt: null, fulfillmentStatus: { in: ["SHIPPED", "DELIVERED"] }, shippedAt: { gte: shippedSince } },
  } satisfies Record<string, Prisma.OrderWhereInput>;
  const lane = async (w: Prisma.OrderWhereInput, orderBy: Prisma.OrderOrderByWithRelationInput[]): Promise<BoardLane> => {
    const [rows, total] = await Promise.all([
      db.order.findMany({ where: w, orderBy, take: LANE_LIMIT, select: cardSelect }),
      db.order.count({ where: w }),
    ]);
    return { cards: rows.map(toCard), total };
  };
  const [awaiting, toPack, packed, shipped] = await Promise.all([
    lane(where.awaiting, [{ placedAt: "asc" }, { number: "asc" }]),
    lane(where.toPack, [{ paidAt: "asc" }, { number: "asc" }]),
    lane(where.packed, [{ paidAt: "asc" }, { number: "asc" }]),
    lane(where.shipped, [{ shippedAt: "desc" }, { number: "desc" }]),
  ]);
  return { awaiting, toPack, packed, shipped, shippedSince };
}

// ─── Packing slips ──────────────────────────────────────────────────────────

export const MAX_PACKING_SLIPS = 100;

/**
 * Packing-slip data for several orders (bulk print), in the given order. Ids of other tenants or
 * unknown ids are skipped silently (they are simply not printed).
 */
export async function packingSlipsData(ctx: ServiceContext, orderIds: string[]) {
  const ids = [...new Set(orderIds.filter((i) => idSchema.safeParse(i).success))].slice(0, MAX_PACKING_SLIPS);
  const out: Awaited<ReturnType<typeof packingSlipData>>[] = [];
  for (const id of ids) {
    try {
      out.push(await packingSlipData(ctx, id));
    } catch (e) {
      if (e instanceof ServiceError && e.code === "NOT_FOUND") continue;
      throw e;
    }
  }
  return out;
}
