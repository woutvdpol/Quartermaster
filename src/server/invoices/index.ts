import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { nextSequenceValue } from "@/server/sequence";
import { enqueue } from "@/server/jobs/queue";
import { getSettings } from "@/server/settings";
import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_VAT_SCHEME, formatInvoiceNumber, invoiceFileName, vatSchemeNotice } from "./format";

export { DEFAULT_VAT_SCHEME, formatInvoiceNumber, invoiceFileName, vatSchemeNotice, VAT_SCHEME_NOTICE } from "./format";

/*
 * Invoices (decision 9 — previously WIP).
 *
 * - One invoice per order (Invoice.orderId is unique); only PAID orders get one.
 * - Number: per-tenant sequence "invoice.number", allocated inside the issuing transaction while the
 *   order row is locked → gapless per tenant, unique under concurrency (@@unique([tenantId, number])).
 *   Shown as INV-{year}-{000123} (see ./format.ts).
 * - VAT: "MARGIN" (margeregeling) by default — no VAT amount on the invoice, only the scheme notice.
 * - Snapshot: amounts/currency are copied onto the Invoice; lines and addresses are already order
 *   snapshots. The PDF itself is rendered once (job `invoices.render`) and stored
 *   (`Invoice.storageKey`), so later changes to the shop's settings don't alter an issued invoice.
 * - Auto-issue: `onOrderFinalized()` queues `invoices.issue` inside the finalization transaction.
 */

type Tx = Prisma.TransactionClient;
const idSchema = z.string().trim().min(1).max(64);

export type IssueResult = {
  invoice: { id: string; number: number; issuedAt: Date } | null;
  /** false = the order already had an invoice (idempotent no-op). */
  created: boolean;
  /** Set when nothing was issued for a non-error reason (auto-issue only). */
  skipped?: "not_paid";
};

export type IssueSource = "manual" | "finalized";

/** Issues the invoice inside `tx` (locks the order row). Throws INVALID for unpaid orders. */
export async function issueInvoiceTx(
  tx: Tx,
  tenantId: string,
  orderId: string,
  opts: { actorId: string | null; source: IssueSource },
): Promise<IssueResult> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM orders WHERE id = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (rows.length === 0) throw new ServiceError("NOT_FOUND", "Order not found");
  const existing = await tx.invoice.findUnique({ where: { orderId }, select: { id: true, number: true, issuedAt: true } });
  if (existing) return { invoice: existing, created: false };

  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { number: true, paymentStatus: true, total: true, currency: true },
  });
  if (order.paymentStatus !== "PAID") throw new ServiceError("INVALID", "Only paid orders can be invoiced");

  const number = await nextSequenceValue(tx, tenantId, "invoice.number");
  const invoice = await tx.invoice.create({
    data: { tenantId, orderId, number, total: order.total, currency: order.currency, vatScheme: DEFAULT_VAT_SCHEME },
    select: { id: true, number: true, issuedAt: true },
  });
  await tx.orderEvent.create({
    data: { tenantId, orderId, type: "invoice.issued", data: { invoiceId: invoice.id, number, source: opts.source }, actorId: opts.actorId },
  });
  // Render the PDF snapshot in the worker right away (only if this transaction commits).
  await enqueue("invoices.render", { tenantId, invoiceId: invoice.id }, { tx });
  return { invoice, created: true };
}

/** Internal/system entry point (job). Unpaid orders are skipped instead of failing the job. */
export async function issueInvoiceForOrder(
  tenantId: string,
  orderId: string,
  opts: { actorId: string | null; source: IssueSource },
): Promise<IssueResult> {
  const id = idSchema.parse(orderId);
  let result: IssueResult;
  try {
    result = await db.$transaction((tx) => issueInvoiceTx(tx, tenantId, id, opts));
  } catch (e) {
    if (opts.source === "finalized" && e instanceof ServiceError && e.code === "INVALID") {
      return { invoice: null, created: false, skipped: "not_paid" };
    }
    throw e;
  }
  if (result.created && result.invoice) {
    await audit({
      action: "invoice.issued",
      tenantId,
      actorId: opts.actorId,
      entity: "Invoice",
      entityId: result.invoice.id,
      data: { orderId: id, number: result.invoice.number, source: opts.source },
    });
  }
  return result;
}

/**
 * Admin "Issue invoice". Only PAID orders (INVALID otherwise); returns the existing invoice when
 * the order already has one (created: false).
 */
export async function issueInvoice(ctx: ServiceContext, orderId: string): Promise<IssueResult> {
  return issueInvoiceForOrder(ctx.tenantId, orderId, { actorId: ctx.actor.id, source: "manual" });
}

/**
 * Auto-issue hook for order finalization. Queues `invoices.issue`; pass the finalizer's `tx` so the
 * job only exists when the finalization commits. Never issues synchronously, so a problem with
 * invoicing can't roll back a paid order's finalization.
 *
 * Hook point: src/server/orders/commands.ts → finalizeOrderTx(), right after queueOrderConfirmation:
 *   await onOrderFinalized(tenantId, orderId, { tx });
 */
export async function onOrderFinalized(tenantId: string, orderId: string, opts: { tx?: Tx } = {}): Promise<void> {
  await enqueue("invoices.issue", { tenantId, orderId }, { tx: opts.tx, singletonKey: `invoice:${orderId}` });
}

/** The order's invoice (tenant-scoped), or null. */
export async function getInvoiceForOrder(ctx: ServiceContext, orderId: string) {
  const id = idSchema.parse(orderId);
  return db.invoice.findFirst({
    where: { tenantId: ctx.tenantId, orderId: id },
    select: { id: true, number: true, issuedAt: true, total: true, currency: true, vatScheme: true, storageKey: true },
  });
}

// ─── Document data ──────────────────────────────────────────────────────────

/** Everything the invoice PDF renders. Plain data (serialisable). */
export async function loadInvoiceDocument(tenantId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      order: { include: { lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, addresses: true } },
    },
  });
  if (!invoice) throw new ServiceError("NOT_FOUND", "Invoice not found");
  const [tenant, general] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, timezone: true } }),
    getSettings(tenantId, "general"),
  ]);
  const { order } = invoice;
  const addr = (type: "SHIPPING" | "BILLING") => {
    const a = order.addresses.find((x) => x.type === type);
    return a
      ? {
          name: `${a.firstName} ${a.lastName}`.trim(),
          company: a.company,
          street: [a.street, a.houseNumber].filter(Boolean).join(" "),
          line2: a.line2,
          postalCode: a.postalCode,
          city: a.city,
          region: a.region,
          countryCode: a.countryCode,
        }
      : null;
  };
  return {
    invoice: {
      id: invoice.id,
      number: invoice.number,
      displayNumber: formatInvoiceNumber(invoice.number, invoice.issuedAt, tenant.timezone),
      fileName: invoiceFileName(invoice.number, invoice.issuedAt, tenant.timezone),
      issuedAt: invoice.issuedAt,
      currency: invoice.currency,
      total: invoice.total,
      vatScheme: invoice.vatScheme,
      vatNotice: vatSchemeNotice(invoice.vatScheme),
    },
    shop: {
      name: general.shopName || tenant.name,
      email: general.contactEmail || null,
      phone: general.phone || null,
      address: general.address,
      cocNumber: general.cocNumber || null,
      vatNumber: general.vatNumber || null,
      iban: general.iban || null,
    },
    order: {
      number: order.number,
      placedAt: order.placedAt,
      paidAt: order.paidAt,
      paymentMethod: order.paymentMethod,
      shippingMethod: order.shippingMethod,
      shippingZoneName: order.shippingZoneName,
      couponCode: order.couponCode,
    },
    customer: { name: order.customerName, email: order.email },
    billingAddress: addr("BILLING") ?? addr("SHIPPING"),
    shippingAddress: addr("SHIPPING"),
    lines: order.lines.map((l) => ({
      title: l.title,
      stockCode: l.stockCode,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    totals: {
      subtotal: order.subtotal,
      discount: order.discountTotal,
      shipping: order.shippingTotal,
      surcharge: order.surchargeTotal,
      total: invoice.total,
    },
    timeZone: tenant.timezone,
  };
}
export type InvoiceDocument = Awaited<ReturnType<typeof loadInvoiceDocument>>;
