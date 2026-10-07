import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { Prisma } from "@/generated/prisma/client";

/*
 * Customers (real table, identity per tenant = lower-cased email — legacy derived them from orders).
 * Totals: `orderCount` counts every order; `paidOrderCount`/`paidRevenue` only PAID orders
 * (legacy counted failed orders in "total spent"). paidRevenue = Σ Order.total (what the customer
 * paid, incl. shipping) — unlike shop revenue KPIs, which exclude shipping.
 */

type Tx = Prisma.TransactionClient;

const idSchema = z.string().trim().min(1).max(64);
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const ANONYMIZED_EMAIL_DOMAIN = "anonymized.invalid";

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["lastOrder", "name", "created", "revenue"]).default("lastOrder"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCustomersQuery = z.input<typeof listSchema>;

type CustomerRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  registered: boolean;
  createdAt: Date;
  orderCount: number;
  paidOrderCount: number;
  paidRevenue: bigint;
  lastOrderAt: Date | null;
  total: number;
};

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listCustomers(ctx: ServiceContext, query: ListCustomersQuery = {}) {
  const q = listSchema.parse(query);
  const term = q.search ? `%${escapeLike(q.search)}%` : null;
  const searchSql = term
    ? Prisma.sql`AND (c.email ILIKE ${term} OR c.phone ILIKE ${term}
        OR concat_ws(' ', c."firstName", c."lastName") ILIKE ${term})`
    : Prisma.empty;
  const orderSql = {
    lastOrder: Prisma.sql`agg."lastOrderAt" DESC NULLS LAST, c."createdAt" DESC`,
    name: Prisma.sql`lower(c."lastName") ASC NULLS LAST, lower(c."firstName") ASC NULLS LAST, c.email ASC`,
    created: Prisma.sql`c."createdAt" DESC`,
    revenue: Prisma.sql`COALESCE(agg."paidRevenue", 0) DESC, agg."lastOrderAt" DESC NULLS LAST`,
  }[q.sort];

  const rows = await db.$queryRaw<CustomerRow[]>`
    SELECT c.id, c.email, c."firstName", c."lastName", c.phone, (c."userId" IS NOT NULL) AS registered, c."createdAt",
      COALESCE(agg."orderCount", 0)::int AS "orderCount",
      COALESCE(agg."paidOrderCount", 0)::int AS "paidOrderCount",
      COALESCE(agg."paidRevenue", 0)::bigint AS "paidRevenue",
      agg."lastOrderAt",
      COUNT(*) OVER ()::int AS total
    FROM customers c
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS "orderCount",
             COUNT(*) FILTER (WHERE o."paymentStatus" = 'PAID') AS "paidOrderCount",
             SUM(o.total) FILTER (WHERE o."paymentStatus" = 'PAID') AS "paidRevenue",
             MAX(o."placedAt") AS "lastOrderAt"
      FROM orders o WHERE o."customerId" = c.id AND o."tenantId" = ${ctx.tenantId}
    ) agg ON true
    WHERE c."tenantId" = ${ctx.tenantId} ${searchSql}
    ORDER BY ${orderSql}, c.id
    LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;

  const total = rows[0]?.total ?? (q.page > 1 ? await countCustomers(ctx.tenantId, term) : 0);
  return {
    items: rows.map((r) => ({
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      phone: r.phone,
      registered: r.registered,
      createdAt: r.createdAt,
      orderCount: r.orderCount,
      paidOrderCount: r.paidOrderCount,
      paidRevenue: Number(r.paidRevenue),
      lastOrderAt: r.lastOrderAt,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

async function countCustomers(tenantId: string, term: string | null) {
  const [r] = await db.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM customers c WHERE c."tenantId" = ${tenantId}
    ${term ? Prisma.sql`AND (c.email ILIKE ${term} OR c.phone ILIKE ${term} OR concat_ws(' ', c."firstName", c."lastName") ILIKE ${term})` : Prisma.empty}`;
  return r.n;
}

export async function getCustomer(ctx: ServiceContext, customerId: string) {
  const id = idSchema.parse(customerId);
  const customer = await db.customer.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: {
      addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
      orders: {
        orderBy: { placedAt: "desc" },
        select: {
          id: true,
          number: true,
          placedAt: true,
          total: true,
          currency: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          archivedAt: true,
        },
      },
      _count: { select: { wishlistItems: true } },
    },
  });
  if (!customer) throw new ServiceError("NOT_FOUND", "Customer not found");
  const { _count, orders, ...rest } = customer;
  const paid = orders.filter((o) => o.paymentStatus === "PAID");
  return {
    ...rest,
    name: [rest.firstName, rest.lastName].filter(Boolean).join(" "),
    registered: rest.userId !== null,
    anonymized: rest.email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`),
    orders,
    wishlistCount: _count.wishlistItems,
    orderCount: orders.length,
    paidOrderCount: paid.length,
    paidRevenue: paid.reduce((s, o) => s + o.total, 0),
    lastOrderAt: orders[0]?.placedAt ?? null,
  };
}
export type CustomerDetail = Awaited<ReturnType<typeof getCustomer>>;

function splitName(name: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const n = name?.trim().replace(/\s+/g, " ");
  if (!n) return { firstName: null, lastName: null };
  const i = n.indexOf(" ");
  return i === -1 ? { firstName: n, lastName: null } : { firstName: n.slice(0, i), lastName: n.slice(i + 1) };
}

const guestSchema = z.object({
  email: emailSchema,
  name: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
});

/**
 * Checkout helper: returns the tenant's customer for this email, creating it if needed. Race-safe
 * (INSERT … ON CONFLICT DO NOTHING via createMany/skipDuplicates). Existing data is never
 * overwritten — only empty name/phone fields are filled in. Run inside the checkout transaction.
 */
export async function findOrCreateGuestCustomer(
  tx: Tx,
  tenantId: string,
  input: { email: string; name?: string | null; phone?: string | null },
) {
  const data = guestSchema.parse(input);
  const { firstName, lastName } = splitName(data.name);
  await tx.customer.createMany({
    data: [{ tenantId, email: data.email, firstName, lastName, phone: data.phone || null }],
    skipDuplicates: true,
  });
  const customer = await tx.customer.findUniqueOrThrow({ where: { tenantId_email: { tenantId, email: data.email } } });
  const fill: Prisma.CustomerUpdateInput = {};
  if (!customer.firstName && firstName) fill.firstName = firstName;
  if (!customer.lastName && lastName) fill.lastName = lastName;
  if (!customer.phone && data.phone) fill.phone = data.phone;
  if (Object.keys(fill).length === 0) return customer;
  return tx.customer.update({ where: { id: customer.id }, data: fill });
}

const updateSchema = z
  .object({
    email: emailSchema.optional(),
    firstName: z.string().trim().max(100).nullish(),
    lastName: z.string().trim().max(100).nullish(),
    phone: z.string().trim().max(40).nullish(),
    notes: z.string().trim().max(5000).nullish(),
  })
  .strict();
export type UpdateCustomerInput = z.input<typeof updateSchema>;

/**
 * Admin edit. Email can only change for guests (a registered customer's email is their login —
 * change it through the account flow). Duplicate email → CONFLICT.
 */
export async function updateCustomer(ctx: ServiceContext, customerId: string, input: UpdateCustomerInput) {
  const id = idSchema.parse(customerId);
  const data = updateSchema.parse(input);
  const existing = await db.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!existing) throw new ServiceError("NOT_FOUND", "Customer not found");
  if (data.email && data.email !== existing.email && existing.userId) {
    throw new ServiceError("INVALID", "Email of a registered customer can't be changed here");
  }
  const patch: Prisma.CustomerUpdateInput = {};
  for (const k of ["email", "firstName", "lastName", "phone", "notes"] as const) {
    if (data[k] !== undefined) (patch as Record<string, unknown>)[k] = data[k] === "" ? null : data[k];
  }
  try {
    const updated = await db.customer.update({ where: { id }, data: patch });
    await audit({
      action: "customer.update",
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      entity: "Customer",
      entityId: id,
      data: { changed: Object.keys(patch) },
    });
    return updated;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ServiceError("CONFLICT", "Another customer already uses this email");
    }
    throw e;
  }
}

/**
 * GDPR erasure ("recht op vergetelheid") that keeps the bookkeeping intact.
 *
 * Kept:     the Customer row (id), all orders with amounts, lines (product snapshots), payments
 *           (amounts/status), shipping country (needed for VAT), timestamps.
 * Scrubbed: customer email (→ anonymized-<id>@anonymized.invalid), names, phone, internal notes,
 *           userId link; order snapshot email/name/phone/customer note; order addresses (all but
 *           countryCode); Payment.raw (Mollie payloads contain consumer name/IBAN).
 * Deleted:  address book, wishlist, carts (+ their reservations via cascade), newsletter subscriptions.
 * Orders matched: linked by customerId OR guest orders with the same email.
 *
 * Not handled here (outside this module): the linked User login account (auth module should
 * disable/delete it), free-text in OrderEvent notes and Order.legacyData (ETL), audit-log rows.
 */
export async function anonymizeCustomer(ctx: ServiceContext, customerId: string) {
  const id = idSchema.parse(customerId);
  const result = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM customers WHERE id = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    if (rows.length === 0) throw new ServiceError("NOT_FOUND", "Customer not found");
    const customer = await tx.customer.findUniqueOrThrow({ where: { id } });
    const anonEmail = `anonymized-${id}@${ANONYMIZED_EMAIL_DOMAIN}`;
    if (customer.email === anonEmail) return { alreadyAnonymized: true, orders: 0, userId: null as string | null };

    const orders = await tx.order.findMany({
      where: { tenantId: ctx.tenantId, OR: [{ customerId: id }, { email: customer.email }] },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    const tenantId = ctx.tenantId;

    if (orderIds.length) {
      await tx.order.updateMany({
        where: { tenantId, id: { in: orderIds } },
        data: { customerId: id, email: anonEmail, customerName: "Anonymized customer", phone: null, customerNote: null },
      });
      await tx.orderAddress.updateMany({
        where: { tenantId, orderId: { in: orderIds } },
        data: {
          firstName: "Anonymized",
          lastName: "",
          company: null,
          street: "-",
          houseNumber: null,
          line2: null,
          postalCode: null,
          city: "-",
          region: null,
          phone: null,
        },
      });
      await tx.payment.updateMany({ where: { tenantId, orderId: { in: orderIds } }, data: { raw: Prisma.DbNull } });
      await tx.orderEvent.createMany({
        data: orderIds.map((orderId) => ({ tenantId, orderId, type: "customer.anonymized", actorId: ctx.actor.id })),
      });
    }

    await tx.address.deleteMany({ where: { tenantId, customerId: id } });
    await tx.wishlistItem.deleteMany({ where: { tenantId, customerId: id } });
    await tx.cart.deleteMany({ where: { tenantId, customerId: id } });
    await tx.newsletterSubscriber.deleteMany({ where: { tenantId, OR: [{ customerId: id }, { email: customer.email }] } });
    await tx.customer.update({
      where: { id },
      data: { email: anonEmail, firstName: null, lastName: null, phone: null, notes: null, userId: null },
    });
    return { alreadyAnonymized: false, orders: orderIds.length, userId: customer.userId };
  });

  if (!result.alreadyAnonymized) {
    // No PII in the audit entry.
    await audit({
      action: "customer.anonymize",
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      entity: "Customer",
      entityId: id,
      data: { orders: result.orders, hadUserAccount: result.userId !== null },
    });
  }
  return result;
}
