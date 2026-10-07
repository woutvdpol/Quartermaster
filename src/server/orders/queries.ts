import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";

/*
 * Order read models for the admin.
 *
 * Views (all tenant-scoped):
 *   open     – not archived AND (PENDING, or PAID but not yet shipped)           ← default working list
 *   toShip   – not archived AND PAID AND fulfillment UNFULFILLED/PACKED
 *   shipped  – not archived AND fulfillment SHIPPED/DELIVERED
 *   failed   – not archived AND paymentStatus FAILED/CANCELED/EXPIRED
 *   archived – archivedAt set (any status)
 *   all      – every order, archived or not (search-everything view)
 * Search/date filters apply to the list and to the per-view counts alike.
 * Date range: `from` inclusive, `to` exclusive, both instants on placedAt (callers convert local days).
 */

export const ORDER_VIEWS = ["open", "toShip", "shipped", "failed", "archived", "all"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

const listSchema = z.object({
  view: z.enum(ORDER_VIEWS).default("open"),
  search: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListOrdersQuery = z.input<typeof listSchema>;

function viewWhere(view: OrderView): Prisma.OrderWhereInput {
  switch (view) {
    case "open":
      return {
        archivedAt: null,
        OR: [{ paymentStatus: "PENDING" }, { paymentStatus: "PAID", fulfillmentStatus: { in: ["UNFULFILLED", "PACKED"] } }],
      };
    case "toShip":
      return { archivedAt: null, paymentStatus: "PAID", fulfillmentStatus: { in: ["UNFULFILLED", "PACKED"] } };
    case "shipped":
      return { archivedAt: null, fulfillmentStatus: { in: ["SHIPPED", "DELIVERED"] } };
    case "failed":
      return { archivedAt: null, paymentStatus: { in: ["FAILED", "CANCELED", "EXPIRED"] } };
    case "archived":
      return { archivedAt: { not: null } };
    case "all":
      return {};
  }
}

function filterWhere(tenantId: string, q: z.output<typeof listSchema>): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [{ tenantId }];
  if (q.from || q.to) and.push({ placedAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } });
  const term = q.search?.replace(/^#/, "").trim();
  if (term) {
    const or: Prisma.OrderWhereInput[] = [
      { email: { contains: term, mode: "insensitive" } },
      { customerName: { contains: term, mode: "insensitive" } },
    ];
    if (/^\d{1,9}$/.test(term)) or.push({ number: Number(term) });
    and.push({ OR: or });
  }
  return { AND: and };
}

export async function listOrders(ctx: ServiceContext, query: ListOrdersQuery = {}) {
  const q = listSchema.parse(query);
  const base = filterWhere(ctx.tenantId, q);
  const where: Prisma.OrderWhereInput = { AND: [base, viewWhere(q.view)] };

  const [rows, counts] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: [{ placedAt: "desc" }, { number: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        number: true,
        placedAt: true,
        paidAt: true,
        customerName: true,
        email: true,
        customerId: true,
        currency: true,
        total: true,
        shippingTotal: true,
        paymentStatus: true,
        paymentMethod: true,
        fulfillmentStatus: true,
        shippingMethod: true,
        shippingZoneName: true,
        archivedAt: true,
        finalizedAt: true,
        canceledAt: true,
        _count: { select: { lines: true } },
        addresses: { where: { type: "SHIPPING" }, select: { countryCode: true, city: true } },
      },
    }),
    viewCounts(base),
  ]);
  const total = counts[q.view];

  return {
    items: rows.map(({ _count, addresses, ...o }) => ({
      ...o,
      lineCount: _count.lines,
      shipTo: addresses[0] ?? null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
    counts,
  };
}

const SHIPPABLE = new Set(["UNFULFILLED", "PACKED"]);
const SHIPPED = new Set(["SHIPPED", "DELIVERED"]);
const FAILED = new Set(["FAILED", "CANCELED", "EXPIRED"]);

/**
 * Per-view counts in 2 queries instead of one COUNT per view: group the non-archived orders by
 * (paymentStatus, fulfillmentStatus) and derive every view from those buckets (mirrors viewWhere()).
 */
async function viewCounts(base: Prisma.OrderWhereInput): Promise<Record<OrderView, number>> {
  const [groups, archived] = await Promise.all([
    db.order.groupBy({
      by: ["paymentStatus", "fulfillmentStatus"],
      where: { AND: [base, { archivedAt: null }] },
      _count: { _all: true },
    }),
    db.order.count({ where: { AND: [base, { archivedAt: { not: null } }] } }),
  ]);
  const c: Record<OrderView, number> = { open: 0, toShip: 0, shipped: 0, failed: 0, archived, all: archived };
  for (const g of groups) {
    const n = g._count._all;
    const paidUnshipped = g.paymentStatus === "PAID" && SHIPPABLE.has(g.fulfillmentStatus);
    c.all += n;
    if (g.paymentStatus === "PENDING" || paidUnshipped) c.open += n;
    if (paidUnshipped) c.toShip += n;
    if (SHIPPED.has(g.fulfillmentStatus)) c.shipped += n;
    if (FAILED.has(g.paymentStatus)) c.failed += n;
  }
  return c;
}
export type OrderListItem = Awaited<ReturnType<typeof listOrders>>["items"][number];

/** Full order detail. `ref` is the order id or `{ number }`. NOT_FOUND for other tenants' orders. */
export async function getOrder(ctx: ServiceContext, ref: string | { number: number }) {
  const where: Prisma.OrderWhereInput =
    typeof ref === "string"
      ? { tenantId: ctx.tenantId, id: z.string().min(1).max(64).parse(ref) }
      : { tenantId: ctx.tenantId, number: z.number().int().positive().parse(ref.number) };

  const order = await db.order.findFirst({
    where,
    include: {
      lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      addresses: true,
      payments: { orderBy: { createdAt: "asc" }, omit: { raw: true } },
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { actor: { select: { id: true, name: true, email: true } } },
      },
      invoice: { select: { id: true, number: true, issuedAt: true } },
    },
  });
  if (!order) throw new ServiceError("NOT_FOUND", "Order not found");

  let customer: { id: string; email: string; name: string; phone: string | null; registered: boolean; orderCount: number; paidOrderCount: number } | null = null;
  if (order.customerId) {
    const c = await db.customer.findFirst({
      where: { id: order.customerId, tenantId: ctx.tenantId },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, userId: true },
    });
    if (c) {
      const [orderCount, paidOrderCount] = await Promise.all([
        db.order.count({ where: { tenantId: ctx.tenantId, customerId: c.id } }),
        db.order.count({ where: { tenantId: ctx.tenantId, customerId: c.id, paymentStatus: "PAID" } }),
      ]);
      customer = {
        id: c.id,
        email: c.email,
        name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        phone: c.phone,
        registered: c.userId !== null,
        orderCount,
        paidOrderCount,
      };
    }
  }

  const { events, ...rest } = order;
  return {
    ...rest,
    shippingAddress: order.addresses.find((a) => a.type === "SHIPPING") ?? null,
    billingAddress: order.addresses.find((a) => a.type === "BILLING") ?? null,
    // BigInt ids → string so the result is serialisable to client components.
    events: events.map((e) => ({
      id: e.id.toString(),
      type: e.type,
      data: e.data,
      createdAt: e.createdAt,
      actor: e.actor ? { id: e.actor.id, name: e.actor.name ?? e.actor.email } : null,
    })),
    customer,
  };
}
export type OrderDetail = Awaited<ReturnType<typeof getOrder>>;
