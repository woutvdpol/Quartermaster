import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import type { Prisma } from "@/generated/prisma/client";
import type { FulfillmentStatus, PaymentStatus } from "@/generated/prisma/enums";
import { recordMovement } from "@/server/stock/ledger";
import { queueOrderConfirmation } from "@/server/mail";
import { onOrderFinalized } from "@/server/invoices";
import { onReservationReleased } from "@/server/alerts/hooks";
import {
  isFinalAttemptStatus,
  isMollieStatus,
  mollieToAttemptStatus,
  mollieToOrderStatus,
  releasesReservations,
  type MollieStatus,
} from "./mollie-status";

/*
 * Order commands. Orders are NEVER deleted (decision 10) — there is deliberately no delete function;
 * use archiveOrder. All mutations are tenant-scoped and lock the order row (FOR UPDATE) before
 * reading state they act on, so concurrent admin clicks / webhooks serialise per order.
 *
 * Event types written to OrderEvent (timeline):
 *   payment.<pending|paid|failed|canceled|expired>, finalized, confirmation_queued, stock.oversold,
 *   reservations.released, canceled, archived, unarchived, note, fulfillment.<packed|shipped|delivered|unfulfilled>
 */

type Tx = Prisma.TransactionClient;

const idSchema = z.string().trim().min(1).max(64);
const noteSchema = z.string().trim().max(5000);

/** Payment statuses that mean money was received; such orders can't be canceled or re-marked paid. */
const SETTLED: PaymentStatus[] = ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"];

async function lockOrder(tx: Tx, tenantId: string, orderId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM orders WHERE id = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (rows.length === 0) throw new ServiceError("NOT_FOUND", "Order not found");
  return tx.order.findUniqueOrThrow({ where: { id: orderId } });
}

async function addEvent(tx: Tx, tenantId: string, orderId: string, type: string, data?: Prisma.InputJsonValue, actorId?: string | null) {
  await tx.orderEvent.create({ data: { tenantId, orderId, type, data, actorId: actorId ?? null } });
}

/**
 * Releases the order's ACTIVE reservations (cancel / failed payment) and queues a "back available"
 * alert per released product (in `tx`). Returns the number released.
 */
async function releaseOrderReservations(tx: Tx, tenantId: string, orderId: string, now: Date) {
  const released = await tx.reservation.updateManyAndReturn({
    where: { tenantId, orderId, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: now },
    select: { productId: true },
  });
  for (const productId of new Set(released.map((r) => r.productId))) {
    await onReservationReleased(tenantId, productId, { tx });
  }
  return released.length;
}

// ─── Finalization ───────────────────────────────────────────────────────────

export type FinalizeSource = "webhook" | "manual";
export type FinalizeResult = {
  /** false = already finalized earlier (idempotent no-op). */
  finalized: boolean;
  /** Lines whose product had less stock than ordered (paid anyway; needs manual follow-up). */
  oversold: { productId: string; ordered: number; available: number }[];
};

/**
 * Completes a PAID order exactly once: stock SALE movements, reservations → CONVERTED, products
 * at quantity 0 → SOLD, timeline events, the confirmation mails and the invoice auto-issue job.
 *
 * Idempotency/concurrency: `UPDATE orders SET finalizedAt … WHERE finalizedAt IS NULL` is the guard.
 * A concurrent duplicate blocks on the row lock and, after the first commits, matches 0 rows → no-op.
 *
 * Oversell policy: the customer has already paid, so finalization never fails on stock. If a product
 * has less stock than ordered, only the available quantity is booked out and a `stock.oversold`
 * event is written for the owner to resolve (refund / source another item).
 */
export async function finalizeOrder(
  tenantId: string,
  orderId: string,
  opts: { source: FinalizeSource; actorId?: string | null },
): Promise<FinalizeResult> {
  return db.$transaction((tx) => finalizeOrderTx(tx, tenantId, orderId, opts));
}

export async function finalizeOrderTx(
  tx: Tx,
  tenantId: string,
  orderId: string,
  opts: { source: FinalizeSource; actorId?: string | null },
): Promise<FinalizeResult> {
  const order = await tx.order.findFirst({
    where: { id: orderId, tenantId },
    select: { id: true, number: true, paymentStatus: true, finalizedAt: true },
  });
  if (!order) throw new ServiceError("NOT_FOUND", "Order not found");
  if (order.finalizedAt) return { finalized: false, oversold: [] };
  if (order.paymentStatus !== "PAID") throw new ServiceError("INVALID", "Only paid orders can be finalized");

  const now = new Date();
  const claimed = await tx.order.updateMany({
    where: { id: orderId, tenantId, finalizedAt: null, paymentStatus: "PAID" },
    data: { finalizedAt: now },
  });
  if (claimed.count === 0) return { finalized: false, oversold: [] };

  const actorId = opts.actorId ?? null;

  // Convert this order's holds first, so the per-product "release other holds" below never touches them.
  await tx.reservation.updateMany({
    where: { tenantId, orderId, status: "ACTIVE" },
    data: { status: "CONVERTED", releasedAt: now },
  });

  const lines = await tx.orderLine.findMany({ where: { tenantId, orderId }, select: { productId: true, quantity: true } });
  const perProduct = new Map<string, number>();
  for (const l of lines) if (l.productId) perProduct.set(l.productId, (perProduct.get(l.productId) ?? 0) + l.quantity);

  const oversold: FinalizeResult["oversold"] = [];
  // Sorted lock order avoids deadlocks between orders that share products.
  for (const productId of [...perProduct.keys()].sort()) {
    const ordered = perProduct.get(productId)!;
    const rows = await tx.$queryRaw<{ quantity: number }[]>`
      SELECT quantity FROM products WHERE id = ${productId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (rows.length === 0) continue; // product deleted since checkout; the line snapshot remains
    const available = rows[0].quantity;
    const take = Math.min(ordered, Math.max(available, 0));
    if (take < ordered) oversold.push({ productId, ordered, available });
    let quantityAfter = available;
    if (take > 0) {
      ({ quantityAfter } = await recordMovement(tx, {
        tenantId,
        productId,
        delta: -take,
        reason: "SALE",
        orderId,
        actorId,
        note: `Order #${order.number}`,
      }));
    }
    if (quantityAfter === 0) {
      await tx.product.update({ where: { id: productId }, data: { status: "SOLD", soldAt: now } });
      // Nothing left to sell: drop anyone else's cart hold on it.
      await tx.reservation.updateMany({
        where: { tenantId, productId, status: "ACTIVE" },
        data: { status: "RELEASED", releasedAt: now },
      });
    }
  }

  await addEvent(tx, tenantId, orderId, "finalized", { source: opts.source }, actorId);
  if (oversold.length) await addEvent(tx, tenantId, orderId, "stock.oversold", { lines: oversold }, null);
  // Customer + owner confirmation mails, queued in this transaction (claims confirmationSentAt once).
  if (await queueOrderConfirmation(tenantId, orderId, { tx })) {
    await addEvent(tx, tenantId, orderId, "confirmation_queued", undefined, null);
  }
  // Auto-issue the invoice (job, only if this transaction commits).
  await onOrderFinalized(tenantId, orderId, { tx });
  return { finalized: true, oversold };
}

// ─── Payments ───────────────────────────────────────────────────────────────

/**
 * Admin "mark as paid" (bank transfer / cash). Creates a MANUAL Payment, sets the order PAID and
 * finalizes it in the same transaction — unlike legacy, this DOES book out stock and queue mails.
 * Not allowed when already settled (CONFLICT) or when the order was canceled by the admin (INVALID).
 */
export async function markPaidManually(ctx: ServiceContext, orderId: string, note?: string | null) {
  const id = idSchema.parse(orderId);
  const cleanNote = note == null ? null : noteSchema.parse(note) || null;

  const result = await db.$transaction(async (tx) => {
    const order = await lockOrder(tx, ctx.tenantId, id);
    if (SETTLED.includes(order.paymentStatus)) throw new ServiceError("CONFLICT", "Order is already paid");
    if (order.canceledAt) throw new ServiceError("INVALID", "Order was canceled");
    const now = new Date();
    const payment = await tx.payment.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: id,
        provider: "MANUAL",
        method: order.paymentMethod ?? "manual",
        status: "PAID",
        amount: order.total,
        currency: order.currency,
        paidAt: now,
      },
    });
    await tx.order.update({ where: { id }, data: { paymentStatus: "PAID", paidAt: now } });
    await addEvent(
      tx,
      ctx.tenantId,
      id,
      "payment.paid",
      { from: order.paymentStatus, provider: "MANUAL", paymentId: payment.id, note: cleanNote },
      ctx.actor.id,
    );
    const fin = await finalizeOrderTx(tx, ctx.tenantId, id, { source: "manual", actorId: ctx.actor.id });
    return { orderNumber: order.number, paymentId: payment.id, ...fin };
  });

  await audit({
    action: "order.mark_paid",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Order",
    entityId: id,
    data: { number: result.orderNumber, paymentId: result.paymentId, note: cleanNote },
  });
  return result;
}

export type MolliePaymentMeta = {
  method?: string | null;
  /** Last Mollie payload (debugging). Contains PII (consumer name/IBAN) — scrubbed by anonymizeCustomer. */
  raw?: Prisma.InputJsonValue | null;
  paidAt?: Date | null;
  expiresAt?: Date | null;
};

export type ApplyMollieResult = {
  orderId: string;
  attemptStatus: string;
  orderStatus: PaymentStatus;
  changed: boolean;
  finalized: boolean;
  reservationsReleased: number;
};

/**
 * Applies a Mollie payment status (fetched by the webhook handler from the Mollie API — never trust
 * the webhook body) to the Payment row and its order. Idempotent and safe under duplicate webhooks.
 *
 * Rules:
 *  - open/pending/authorized → order PENDING (legacy wrongly marked these failed),
 *    paid → PAID + finalize, failed/canceled/expired → that status + release the order's reservations.
 *  - A PAID order is never downgraded, and a final attempt status is never overwritten.
 *  - Non-paid outcomes only change the order when this payment is the order's latest attempt, so a
 *    late "expired" for an old attempt can't kill a retry that is still open.
 */
export async function applyMolliePaymentStatus(
  tenantId: string,
  providerPaymentId: string,
  mollieStatus: string,
  meta: MolliePaymentMeta = {},
): Promise<ApplyMollieResult> {
  if (!isMollieStatus(mollieStatus)) throw new ServiceError("INVALID", `Unknown Mollie status "${mollieStatus}"`);
  const status: MollieStatus = mollieStatus;
  const pid = z.string().trim().min(1).max(64).parse(providerPaymentId);

  return db.$transaction(async (tx) => {
    const payRows = await tx.$queryRaw<{ id: string; orderId: string }[]>`
      SELECT id, "orderId" FROM payments
      WHERE "providerPaymentId" = ${pid} AND "tenantId" = ${tenantId} AND provider = 'MOLLIE' FOR UPDATE`;
    if (payRows.length === 0) throw new ServiceError("NOT_FOUND", "Payment not found");
    const { id: paymentId, orderId } = payRows[0];
    const order = await lockOrder(tx, tenantId, orderId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });

    const now = new Date();
    const nextAttempt = mollieToAttemptStatus(status);
    const attemptChanged = payment.status !== nextAttempt && !isFinalAttemptStatus(payment.status);
    if (attemptChanged) {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: nextAttempt,
          method: meta.method ?? payment.method,
          raw: meta.raw ?? undefined,
          expiresAt: meta.expiresAt ?? payment.expiresAt,
          paidAt: nextAttempt === "PAID" ? (meta.paidAt ?? now) : payment.paidAt,
          failedAt: nextAttempt === "FAILED" ? now : payment.failedAt,
          canceledAt: nextAttempt === "CANCELED" ? now : payment.canceledAt,
          expiredAt: nextAttempt === "EXPIRED" ? now : payment.expiredAt,
        },
      });
    }

    let orderStatus = order.paymentStatus;
    let changed = attemptChanged;
    let finalized = false;
    let reservationsReleased = 0;
    const target = mollieToOrderStatus(status);
    const effectiveAttempt = attemptChanged ? nextAttempt : payment.status;

    if (effectiveAttempt === "PAID") {
      if (!SETTLED.includes(order.paymentStatus)) {
        const paidAt = meta.paidAt ?? now;
        await tx.order.update({
          where: { id: orderId },
          data: { paymentStatus: "PAID", paidAt, paymentMethod: meta.method ?? order.paymentMethod },
        });
        await addEvent(tx, tenantId, orderId, "payment.paid", { from: order.paymentStatus, provider: "MOLLIE", paymentId: pid });
        orderStatus = "PAID";
        changed = true;
      }
      if (orderStatus === "PAID") finalized = (await finalizeOrderTx(tx, tenantId, orderId, { source: "webhook" })).finalized;
    } else if (attemptChanged && !SETTLED.includes(order.paymentStatus)) {
      const latest = await tx.payment.findFirst({
        where: { tenantId, orderId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (latest?.id === paymentId && order.paymentStatus !== target) {
        await tx.order.update({ where: { id: orderId }, data: { paymentStatus: target } });
        await addEvent(tx, tenantId, orderId, `payment.${target.toLowerCase()}`, {
          from: order.paymentStatus,
          provider: "MOLLIE",
          paymentId: pid,
          mollieStatus: status,
        });
        orderStatus = target;
      }
      if (latest?.id === paymentId && releasesReservations(status)) {
        reservationsReleased = await releaseOrderReservations(tx, tenantId, orderId, now);
        if (reservationsReleased) await addEvent(tx, tenantId, orderId, "reservations.released", { count: reservationsReleased, reason: status });
      }
    }

    return { orderId, attemptStatus: effectiveAttempt, orderStatus, changed, finalized, reservationsReleased };
  });
}

// ─── Admin lifecycle ────────────────────────────────────────────────────────

/**
 * Cancels an unpaid order: releases its reservations, paymentStatus → CANCELED, canceledAt.
 * Paid/refunded orders can't be canceled (CONFLICT) — that needs a refund flow (not built yet).
 * TODO(mollie): also cancel an open Mollie payment via the API once the Mollie client exists.
 */
export async function cancelOrder(ctx: ServiceContext, orderId: string, reason?: string | null) {
  const id = idSchema.parse(orderId);
  const cleanReason = reason == null ? null : noteSchema.parse(reason) || null;
  const result = await db.$transaction(async (tx) => {
    const order = await lockOrder(tx, ctx.tenantId, id);
    if (SETTLED.includes(order.paymentStatus) || order.finalizedAt) {
      throw new ServiceError("CONFLICT", "Paid orders can't be canceled");
    }
    if (order.canceledAt) throw new ServiceError("CONFLICT", "Order is already canceled");
    const now = new Date();
    const released = await releaseOrderReservations(tx, ctx.tenantId, id, now);
    await tx.order.update({ where: { id }, data: { paymentStatus: "CANCELED", canceledAt: now } });
    await addEvent(tx, ctx.tenantId, id, "canceled", { from: order.paymentStatus, reason: cleanReason, reservationsReleased: released }, ctx.actor.id);
    return { number: order.number, reservationsReleased: released };
  });
  await audit({ action: "order.cancel", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Order", entityId: id, data: { ...result, reason: cleanReason } });
  return result;
}

async function setArchived(ctx: ServiceContext, orderId: string, archived: boolean) {
  const id = idSchema.parse(orderId);
  const changed = await db.$transaction(async (tx) => {
    const order = await lockOrder(tx, ctx.tenantId, id);
    if (Boolean(order.archivedAt) === archived) return false; // idempotent
    await tx.order.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await addEvent(tx, ctx.tenantId, id, archived ? "archived" : "unarchived", undefined, ctx.actor.id);
    return true;
  });
  if (changed) {
    await audit({ action: archived ? "order.archive" : "order.unarchive", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Order", entityId: id });
  }
  return { changed };
}

/** Archives an order (hides it from the working views). Orders are never deleted. Idempotent. */
export function archiveOrder(ctx: ServiceContext, orderId: string) {
  return setArchived(ctx, orderId, true);
}

export function unarchiveOrder(ctx: ServiceContext, orderId: string) {
  return setArchived(ctx, orderId, false);
}

/** Adds an internal note to the order timeline (event type "note"). */
export async function addOrderNote(ctx: ServiceContext, orderId: string, note: string) {
  const id = idSchema.parse(orderId);
  const text = noteSchema.min(1).parse(note);
  const exists = await db.order.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
  if (!exists) throw new ServiceError("NOT_FOUND", "Order not found");
  const event = await db.orderEvent.create({ data: { tenantId: ctx.tenantId, orderId: id, type: "note", data: { note: text }, actorId: ctx.actor.id } });
  await audit({ action: "order.note", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Order", entityId: id });
  return { id: event.id.toString() };
}

const fulfillmentSchema = z.object({
  status: z.enum(["UNFULFILLED", "PACKED", "SHIPPED", "DELIVERED"]),
  carrier: z.string().trim().max(100).nullish(),
  trackingNumber: z.string().trim().max(200).nullish(),
  trackingUrl: z.url({ protocol: /^https?$/ }).max(1000).nullish(),
});
export type FulfillmentInput = z.input<typeof fulfillmentSchema>;

/**
 * WIP (decision 8) but functional: sets the fulfillment status (+ optional carrier/tracking).
 * Only PAID orders can move past UNFULFILLED. shippedAt/deliveredAt are set the first time.
 */
export async function setFulfillmentStatus(ctx: ServiceContext, orderId: string, input: FulfillmentInput) {
  const id = idSchema.parse(orderId);
  const data = fulfillmentSchema.parse(input);
  const result = await db.$transaction(async (tx) => {
    const order = await lockOrder(tx, ctx.tenantId, id);
    if (data.status !== "UNFULFILLED" && order.paymentStatus !== "PAID") {
      throw new ServiceError("INVALID", "Only paid orders can be fulfilled");
    }
    const now = new Date();
    const update: Prisma.OrderUpdateInput = { fulfillmentStatus: data.status as FulfillmentStatus };
    if (data.carrier !== undefined) update.carrier = data.carrier || null;
    if (data.trackingNumber !== undefined) update.trackingNumber = data.trackingNumber || null;
    if (data.trackingUrl !== undefined) update.trackingUrl = data.trackingUrl || null;
    if ((data.status === "SHIPPED" || data.status === "DELIVERED") && !order.shippedAt) update.shippedAt = now;
    if (data.status === "DELIVERED" && !order.deliveredAt) update.deliveredAt = now;
    await tx.order.update({ where: { id }, data: update });
    await addEvent(
      tx,
      ctx.tenantId,
      id,
      `fulfillment.${data.status.toLowerCase()}`,
      { from: order.fulfillmentStatus, to: data.status, carrier: data.carrier ?? null, trackingNumber: data.trackingNumber ?? null },
      ctx.actor.id,
    );
    // TODO(mail): "shipped" mail with tracking link once the mail module exists.
    return { from: order.fulfillmentStatus, to: data.status };
  });
  await audit({ action: "order.fulfillment", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Order", entityId: id, data: result });
  return result;
}

// ─── Packing slip ───────────────────────────────────────────────────────────

/**
 * Plain data for the packing-slip PDF (rendered elsewhere). Prices are included only when the
 * `checkout.packingSlipPrices` setting is on, and are always in the ORDER currency (legacy bug used
 * the admin's session currency).
 */
export async function packingSlipData(ctx: ServiceContext, orderId: string) {
  const id = idSchema.parse(orderId);
  const order = await db.order.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: { lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, addresses: true },
  });
  if (!order) throw new ServiceError("NOT_FOUND", "Order not found");
  const [general, checkout, domain] = await Promise.all([
    getSettings(ctx.tenantId, "general"),
    getSettings(ctx.tenantId, "checkout"),
    db.tenantDomain.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { host: true } }),
  ]);
  const showPrices = checkout.packingSlipPrices;
  const address = (type: "SHIPPING" | "BILLING") => {
    const a = order.addresses.find((x) => x.type === type);
    if (!a) return null;
    return {
      firstName: a.firstName,
      lastName: a.lastName,
      company: a.company,
      street: a.street,
      houseNumber: a.houseNumber,
      line2: a.line2,
      postalCode: a.postalCode,
      city: a.city,
      region: a.region,
      countryCode: a.countryCode,
      phone: a.phone,
    };
  };
  return {
    shop: { name: general.shopName, email: general.contactEmail, phone: general.phone, address: general.address, domain: domain?.host ?? null },
    order: {
      number: order.number,
      placedAt: order.placedAt,
      paidAt: order.paidAt,
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      shippingMethod: order.shippingMethod,
      shippingZoneName: order.shippingZoneName,
      customerNote: order.customerNote,
    },
    customer: { name: order.customerName, email: order.email, phone: order.phone },
    shippingAddress: address("SHIPPING"),
    billingAddress: address("BILLING"),
    lines: order.lines.map((l) => ({
      stockCode: l.stockCode,
      sku: l.sku,
      title: l.title,
      quantity: l.quantity,
      unitPrice: showPrices ? l.unitPrice : null,
      lineTotal: showPrices ? l.lineTotal : null,
    })),
    itemCount: order.lines.reduce((n, l) => n + l.quantity, 0),
    showPrices,
    totals: showPrices
      ? {
          subtotal: order.subtotal,
          discount: order.discountTotal,
          couponCode: order.couponCode,
          shipping: order.shippingTotal,
          surcharge: order.surchargeTotal,
          surchargeLabel: order.surchargeLabel,
          total: order.total,
        }
      : null,
  };
}
export type PackingSlipData = Awaited<ReturnType<typeof packingSlipData>>;
