import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { Prisma } from "@/generated/prisma/client";

/*
 * Purchasing (decision 12): suppliers ("product origins"), purchase records (one invoice/lot →
 * N products), purchase prices per product, and the margin report.
 *
 * Margin model: each Product carries its own allocated cost (`purchasePrice`); at sale time the
 * OrderLine snapshots it (`purchasePriceSnapshot`). The report only reads snapshots, so later
 * price edits don't rewrite history — except that `setPurchasePrices` back-fills snapshots that are
 * still NULL (cost entered after the sale, common for unique items), unless told not to.
 */

const idSchema = z.string().trim().min(1).max(64);
const money = z.int().min(0).max(1_000_000_000);

function conflictOnUnique<T>(p: Promise<T>, message: string): Promise<T> {
  return p.catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ServiceError("CONFLICT", message);
    throw e;
  });
}

// ─── Suppliers ──────────────────────────────────────────────────────────────

const supplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contact: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
});
export type SupplierInput = z.input<typeof supplierSchema>;

export async function listSuppliers(ctx: ServiceContext, query: { search?: string } = {}) {
  const search = z.string().trim().max(200).optional().parse(query.search);
  const rows = await db.supplier.findMany({
    where: { tenantId: ctx.tenantId, ...(search && { name: { contains: search, mode: "insensitive" } }) },
    orderBy: { name: "asc" },
    include: { _count: { select: { purchaseRecords: true } } },
  });
  return rows.map(({ _count, ...s }) => ({ ...s, purchaseRecordCount: _count.purchaseRecords }));
}

export async function getSupplier(ctx: ServiceContext, supplierId: string) {
  const s = await db.supplier.findFirst({
    where: { id: idSchema.parse(supplierId), tenantId: ctx.tenantId },
    include: { purchaseRecords: { orderBy: { purchasedAt: "desc" }, include: { _count: { select: { products: true } } } } },
  });
  if (!s) throw new ServiceError("NOT_FOUND", "Supplier not found");
  return s;
}

export async function createSupplier(ctx: ServiceContext, input: SupplierInput) {
  const data = supplierSchema.parse(input);
  const s = await conflictOnUnique(
    db.supplier.create({ data: { tenantId: ctx.tenantId, name: data.name, contact: data.contact || null, notes: data.notes || null } }),
    "A supplier with this name already exists",
  );
  await audit({ action: "supplier.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Supplier", entityId: s.id });
  return s;
}

export async function updateSupplier(ctx: ServiceContext, supplierId: string, input: Partial<SupplierInput>) {
  const id = idSchema.parse(supplierId);
  const data = supplierSchema.partial().parse(input);
  const res = await conflictOnUnique(
    db.supplier.updateMany({
      where: { id, tenantId: ctx.tenantId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.contact !== undefined && { contact: data.contact || null }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
      },
    }),
    "A supplier with this name already exists",
  );
  if (res.count === 0) throw new ServiceError("NOT_FOUND", "Supplier not found");
  await audit({ action: "supplier.update", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Supplier", entityId: id });
  return db.supplier.findUniqueOrThrow({ where: { id } });
}

/** Deleting is only allowed while no purchase record references the supplier (keeps margin-by-supplier intact). */
export async function deleteSupplier(ctx: ServiceContext, supplierId: string) {
  const id = idSchema.parse(supplierId);
  await db.$transaction(async (tx) => {
    const s = await tx.supplier.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { _count: { select: { purchaseRecords: true } } } });
    if (!s) throw new ServiceError("NOT_FOUND", "Supplier not found");
    if (s._count.purchaseRecords > 0) throw new ServiceError("CONFLICT", "Supplier has purchase records");
    await tx.supplier.delete({ where: { id } });
  });
  await audit({ action: "supplier.delete", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Supplier", entityId: id });
}

// ─── Purchase records ───────────────────────────────────────────────────────

const recordSchema = z.object({
  purchasedAt: z.coerce.date(),
  supplierId: idSchema.nullish(),
  invoiceNumber: z.string().trim().max(100).nullish(),
  totalCost: money.nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  notes: z.string().trim().max(5000).nullish(),
  productIds: z.array(idSchema).max(1000).optional(),
});
export type PurchaseRecordInput = z.input<typeof recordSchema>;

async function assertSupplier(tx: Prisma.TransactionClient, tenantId: string, supplierId: string | null | undefined) {
  if (!supplierId) return;
  const s = await tx.supplier.findFirst({ where: { id: supplierId, tenantId }, select: { id: true } });
  if (!s) throw new ServiceError("NOT_FOUND", "Supplier not found");
}

async function linkProductsTx(tx: Prisma.TransactionClient, tenantId: string, recordId: string, productIds: string[]) {
  const ids = [...new Set(productIds)];
  if (!ids.length) return 0;
  const res = await tx.product.updateMany({ where: { tenantId, id: { in: ids } }, data: { purchaseRecordId: recordId } });
  if (res.count !== ids.length) throw new ServiceError("NOT_FOUND", "One or more products not found");
  return res.count;
}

const listRecordsSchema = z.object({
  supplierId: idSchema.optional(),
  search: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listPurchaseRecords(ctx: ServiceContext, query: z.input<typeof listRecordsSchema> = {}) {
  const q = listRecordsSchema.parse(query);
  const where: Prisma.PurchaseRecordWhereInput = {
    tenantId: ctx.tenantId,
    ...(q.supplierId && { supplierId: q.supplierId }),
    ...((q.from || q.to) && { purchasedAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
    ...(q.search && {
      OR: [
        { invoiceNumber: { contains: q.search, mode: "insensitive" } },
        { notes: { contains: q.search, mode: "insensitive" } },
        { supplier: { name: { contains: q.search, mode: "insensitive" } } },
      ],
    }),
  };
  const [rows, total] = await Promise.all([
    db.purchaseRecord.findMany({
      where,
      orderBy: [{ purchasedAt: "desc" }, { createdAt: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { supplier: { select: { id: true, name: true } }, _count: { select: { products: true } } },
    }),
    db.purchaseRecord.count({ where }),
  ]);
  return {
    items: rows.map(({ _count, ...r }) => ({ ...r, productCount: _count.products })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/** Record with its products and the allocated cost (Σ product purchasePrice) vs invoiced totalCost. */
export async function getPurchaseRecord(ctx: ServiceContext, recordId: string) {
  const r = await db.purchaseRecord.findFirst({
    where: { id: idSchema.parse(recordId), tenantId: ctx.tenantId },
    include: {
      supplier: { select: { id: true, name: true } },
      products: {
        orderBy: { stockCode: "asc" },
        select: { id: true, stockCode: true, title: true, status: true, price: true, purchasePrice: true, quantity: true, soldAt: true },
      },
    },
  });
  if (!r) throw new ServiceError("NOT_FOUND", "Purchase record not found");
  const allocatedCost = r.products.reduce((s, p) => s + (p.purchasePrice ?? 0), 0);
  return { ...r, allocatedCost, unallocatedCost: r.totalCost == null ? null : r.totalCost - allocatedCost };
}

export async function createPurchaseRecord(ctx: ServiceContext, input: PurchaseRecordInput) {
  const data = recordSchema.parse(input);
  const record = await db.$transaction(async (tx) => {
    await assertSupplier(tx, ctx.tenantId, data.supplierId);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { currency: true } });
    const r = await tx.purchaseRecord.create({
      data: {
        tenantId: ctx.tenantId,
        purchasedAt: data.purchasedAt,
        supplierId: data.supplierId || null,
        invoiceNumber: data.invoiceNumber || null,
        totalCost: data.totalCost ?? null,
        currency: data.currency ?? tenant.currency,
        notes: data.notes || null,
      },
    });
    if (data.productIds) await linkProductsTx(tx, ctx.tenantId, r.id, data.productIds);
    return r;
  });
  await audit({ action: "purchase_record.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "PurchaseRecord", entityId: record.id });
  return record;
}

/** Updates fields; when `productIds` is given it REPLACES the linked product set. */
export async function updatePurchaseRecord(ctx: ServiceContext, recordId: string, input: Partial<PurchaseRecordInput>) {
  const id = idSchema.parse(recordId);
  const data = recordSchema.partial().parse(input);
  const record = await db.$transaction(async (tx) => {
    const existing = await tx.purchaseRecord.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
    if (!existing) throw new ServiceError("NOT_FOUND", "Purchase record not found");
    if (data.supplierId !== undefined) await assertSupplier(tx, ctx.tenantId, data.supplierId);
    const r = await tx.purchaseRecord.update({
      where: { id },
      data: {
        ...(data.purchasedAt !== undefined && { purchasedAt: data.purchasedAt }),
        ...(data.supplierId !== undefined && { supplierId: data.supplierId || null }),
        ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber || null }),
        ...(data.totalCost !== undefined && { totalCost: data.totalCost ?? null }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
      },
    });
    if (data.productIds) {
      await tx.product.updateMany({
        where: { tenantId: ctx.tenantId, purchaseRecordId: id, id: { notIn: data.productIds } },
        data: { purchaseRecordId: null },
      });
      await linkProductsTx(tx, ctx.tenantId, id, data.productIds);
    }
    return r;
  });
  await audit({ action: "purchase_record.update", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "PurchaseRecord", entityId: id });
  return record;
}

/** Deletes the record; linked products are unlinked (their purchasePrice is kept). */
export async function deletePurchaseRecord(ctx: ServiceContext, recordId: string) {
  const id = idSchema.parse(recordId);
  const res = await db.purchaseRecord.deleteMany({ where: { id, tenantId: ctx.tenantId } });
  if (res.count === 0) throw new ServiceError("NOT_FOUND", "Purchase record not found");
  await audit({ action: "purchase_record.delete", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "PurchaseRecord", entityId: id });
}

export async function linkProductsToPurchaseRecord(ctx: ServiceContext, recordId: string, productIds: string[]) {
  const id = idSchema.parse(recordId);
  const ids = z.array(idSchema).max(1000).parse(productIds);
  const count = await db.$transaction(async (tx) => {
    const r = await tx.purchaseRecord.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
    if (!r) throw new ServiceError("NOT_FOUND", "Purchase record not found");
    return linkProductsTx(tx, ctx.tenantId, id, ids);
  });
  await audit({ action: "purchase_record.link", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "PurchaseRecord", entityId: id, data: { productIds: ids } });
  return { linked: count };
}

export async function unlinkProductsFromPurchaseRecord(ctx: ServiceContext, recordId: string, productIds: string[]) {
  const id = idSchema.parse(recordId);
  const ids = z.array(idSchema).max(1000).parse(productIds);
  const res = await db.product.updateMany({
    where: { tenantId: ctx.tenantId, purchaseRecordId: id, id: { in: ids } },
    data: { purchaseRecordId: null },
  });
  await audit({ action: "purchase_record.unlink", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "PurchaseRecord", entityId: id, data: { productIds: ids } });
  return { unlinked: res.count };
}

// ─── Purchase prices ────────────────────────────────────────────────────────

const pricesSchema = z.object({
  prices: z.array(z.object({ productId: idSchema, purchasePrice: money.nullable() })).min(1).max(1000),
  backfillOrderLines: z.boolean().default(true),
});

/**
 * Sets Product.purchasePrice (minor units, null = unknown). With `backfillOrderLines` (default) also
 * fills OrderLine.purchasePriceSnapshot where it is still NULL — never overwrites an existing snapshot.
 */
export async function setPurchasePrices(
  ctx: ServiceContext,
  input: { prices: { productId: string; purchasePrice: number | null }[]; backfillOrderLines?: boolean },
) {
  const { prices, backfillOrderLines } = pricesSchema.parse(input);
  const result = await db.$transaction(async (tx) => {
    let backfilled = 0;
    for (const p of prices) {
      const res = await tx.product.updateMany({ where: { id: p.productId, tenantId: ctx.tenantId }, data: { purchasePrice: p.purchasePrice } });
      if (res.count === 0) throw new ServiceError("NOT_FOUND", "Product not found", { productId: p.productId });
      if (backfillOrderLines && p.purchasePrice != null) {
        const lines = await tx.orderLine.updateMany({
          where: { tenantId: ctx.tenantId, productId: p.productId, purchasePriceSnapshot: null },
          data: { purchasePriceSnapshot: p.purchasePrice },
        });
        backfilled += lines.count;
      }
    }
    return { updated: prices.length, orderLinesBackfilled: backfilled };
  });
  await audit({
    action: "product.purchase_price",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Product",
    data: { prices, backfillOrderLines },
  });
  return result;
}

/**
 * Splits the record's totalCost over its linked products and stores it as their purchasePrice.
 * "equal": evenly; "byPrice": proportional to the selling price. Rounding remainder goes to the
 * first products so the allocation sums exactly to totalCost.
 */
export async function allocatePurchaseRecordCost(ctx: ServiceContext, recordId: string, method: "equal" | "byPrice" = "equal") {
  const id = idSchema.parse(recordId);
  const m = z.enum(["equal", "byPrice"]).parse(method);
  const r = await db.purchaseRecord.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: { products: { orderBy: { stockCode: "asc" }, select: { id: true, price: true } } },
  });
  if (!r) throw new ServiceError("NOT_FOUND", "Purchase record not found");
  if (r.totalCost == null) throw new ServiceError("INVALID", "Purchase record has no total cost");
  if (r.products.length === 0) throw new ServiceError("INVALID", "Purchase record has no products");
  const weights = r.products.map((p) => (m === "byPrice" ? p.price : 1));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const effective = sumW === 0 ? r.products.map(() => 1) : weights;
  const total = effective.reduce((a, b) => a + b, 0);
  const shares = effective.map((w) => Math.floor((r.totalCost! * w) / total));
  let rest = r.totalCost - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % shares.length, rest--) shares[i] += 1;
  return setPurchasePrices(ctx, { prices: r.products.map((p, i) => ({ productId: p.id, purchasePrice: shares[i] })) });
}

// ─── Margin report ──────────────────────────────────────────────────────────

const marginSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  groupBy: z.enum(["category", "supplier", "month"]),
});

export type MarginRow = {
  key: string | null;
  label: string;
  lines: number;
  /** Σ lineTotal of all lines (excl. shipping/surcharge). */
  revenue: number;
  /** Σ lineTotal of lines that have a cost snapshot — margin is computed over these only. */
  costedRevenue: number;
  cost: number;
  margin: number;
  /** margin / costedRevenue × 100, one decimal; null when nothing is costed. */
  marginPct: number | null;
  linesMissingCost: number;
};

/**
 * Margin per category / supplier / month over PAID orders paid in [from, to) (COALESCE(paidAt,
 * placedAt)), from OrderLine snapshots: revenue = lineTotal, cost = purchasePriceSnapshot × quantity.
 * Shipping and surcharges are excluded by construction. Category/supplier are the product's CURRENT
 * category / purchase record supplier (not snapshotted); deleted products fall under "Unknown".
 * Months are tenant-local (Tenant.timezone).
 */
export async function marginReport(ctx: ServiceContext, input: z.input<typeof marginSchema>) {
  const q = marginSchema.parse(input);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true, currency: true } });
  const tz = tenant.timezone;
  const groupSql = {
    category: Prisma.sql`cat.id AS key, COALESCE(cat.title, 'Uncategorized') AS label`,
    supplier: Prisma.sql`s.id AS key, COALESCE(s.name, 'Unknown supplier') AS label`,
    month: Prisma.sql`to_char(date_trunc('month', (COALESCE(o."paidAt", o."placedAt") AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM') AS key,
                      to_char(date_trunc('month', (COALESCE(o."paidAt", o."placedAt") AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM') AS label`,
  }[q.groupBy];

  const rows = await db.$queryRaw<
    { key: string | null; label: string; lines: number; revenue: bigint; costed_revenue: bigint; cost: bigint; missing: number }[]
  >`
    SELECT ${groupSql},
      COUNT(*)::int AS lines,
      SUM(ol."lineTotal")::bigint AS revenue,
      COALESCE(SUM(ol."lineTotal") FILTER (WHERE ol."purchasePriceSnapshot" IS NOT NULL), 0)::bigint AS costed_revenue,
      COALESCE(SUM(ol."purchasePriceSnapshot"::bigint * ol.quantity), 0)::bigint AS cost,
      COUNT(*) FILTER (WHERE ol."purchasePriceSnapshot" IS NULL)::int AS missing
    FROM order_lines ol
    JOIN orders o ON o.id = ol."orderId" AND o."tenantId" = ${ctx.tenantId}
    LEFT JOIN products p ON p.id = ol."productId"
    LEFT JOIN categories cat ON cat.id = p."categoryId"
    LEFT JOIN purchase_records pr ON pr.id = p."purchaseRecordId"
    LEFT JOIN suppliers s ON s.id = pr."supplierId"
    WHERE ol."tenantId" = ${ctx.tenantId}
      AND o."paymentStatus" = 'PAID'
      AND COALESCE(o."paidAt", o."placedAt") >= (${q.from.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND COALESCE(o."paidAt", o."placedAt") < (${q.to.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY 1, 2
    ORDER BY ${q.groupBy === "month" ? Prisma.sql`1 ASC` : Prisma.sql`SUM(ol."lineTotal") DESC, 2 ASC`}`;

  const toRow = (key: string | null, label: string, lines: number, revenue: number, costedRevenue: number, cost: number, missing: number): MarginRow => ({
    key,
    label,
    lines,
    revenue,
    costedRevenue,
    cost,
    margin: costedRevenue - cost,
    marginPct: costedRevenue === 0 ? null : Math.round(((costedRevenue - cost) / costedRevenue) * 1000) / 10,
    linesMissingCost: missing,
  });
  const groups = rows.map((r) => toRow(r.key, r.label, r.lines, Number(r.revenue), Number(r.costed_revenue), Number(r.cost), r.missing));
  const sum = (k: keyof MarginRow) => groups.reduce((s, g) => s + (g[k] as number), 0);
  return {
    currency: tenant.currency,
    from: q.from,
    to: q.to,
    groupBy: q.groupBy,
    groups,
    totals: toRow(null, "Total", sum("lines"), sum("revenue"), sum("costedRevenue"), sum("cost"), sum("linesMissingCost")),
  };
}
