import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { getSettings } from "@/server/settings";
import { reserveProduct } from "@/server/stock/reservations";
import { applyMolliePaymentStatus } from "@/server/orders/commands";
import { createMolliePayment } from "@/server/payments/mollie";
import { getMollieCredentials } from "@/server/payments/mollie-config";
import { isDevSimulationAllowed } from "./payment-methods";
import { mollieWebhookUrl, orderStatusPath, shopBaseUrl } from "./urls";

/*
 * Starting / retrying the Mollie payment of an order. Nothing here marks an order paid: that only
 * happens in the webhook (orders/commands.applyMolliePaymentStatus re-fetches from Mollie).
 * The dev simulation (no Mollie key, NODE_ENV !== "production") feeds a fake payment through that
 * same applyMolliePaymentStatus path so the full flow — finalization, stock, mails — can be demoed.
 */

const PAYMENT_HOLD_MINUTES = 30;
/** A failed/expired order can be retried this long after it was placed. */
export const RETRY_WINDOW_MS = 72 * 60 * 60 * 1000;
const uuidSchema = z.uuid();

export type StartPaymentResult =
  | { kind: "redirect"; url: string }
  | { kind: "order"; reason: "not_configured" | "processing" | "not_payable" }
  | { kind: "error"; message: string };

/**
 * Sends the customer to Mollie for an order that is PENDING. Reuses the latest attempt while it is
 * still open (double clicks / back button), so at most one open payment is created per order at a
 * time (advisory lock per order). Never throws for Mollie problems — returns `{ kind: "error" }`.
 */
export async function startOrderPayment(tenantId: string, orderId: string, opts: { host: string }): Promise<StartPaymentResult> {
  const creds = await getMollieCredentials(tenantId);
  if (!creds) return { kind: "order", reason: "not_configured" };
  const base = shopBaseUrl(opts.host);

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qm:pay:${orderId}`}))`;
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        select: { id: true, uuid: true, paymentStatus: true, paymentMethod: true, canceledAt: true, archivedAt: true },
      });
      if (!order) throw new ServiceError("NOT_FOUND", "Order not found");
      if (order.paymentStatus !== "PENDING" || order.canceledAt || order.archivedAt) return { kind: "order", reason: "not_payable" } as const;

      const latest = await tx.payment.findFirst({
        where: { tenantId, orderId, provider: "MOLLIE" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { status: true, checkoutUrl: true, expiresAt: true },
      });
      if (latest?.status === "OPEN" && latest.checkoutUrl && (!latest.expiresAt || latest.expiresAt.getTime() > Date.now() + 60_000)) {
        return { kind: "redirect", url: latest.checkoutUrl } as const;
      }
      if (latest && (latest.status === "PENDING" || latest.status === "AUTHORIZED")) return { kind: "order", reason: "processing" } as const;

      try {
        const created = await createMolliePayment(
          tenantId,
          { id: order.id },
          {
            redirectUrl: `${base}${orderStatusPath(order.uuid)}`,
            webhookUrl: mollieWebhookUrl(tenantId, base),
            method: order.paymentMethod ?? undefined,
          },
        );
        return created.checkoutUrl ? ({ kind: "redirect", url: created.checkoutUrl } as const) : ({ kind: "order", reason: "processing" } as const);
      } catch (err) {
        if (err instanceof ServiceError) {
          console.warn(`[checkout] ${tenantId}: starting payment for order ${orderId} failed: ${err.code} ${err.message}`);
          return { kind: "error", message: err.code === "CONFLICT" ? "This order can no longer be paid" : "We couldn't start the payment. Please try again in a moment." } as const;
        }
        throw err;
      }
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

export type RetryResult =
  | { ok: true; orderId: string }
  | { ok: false; reason: "not_found" | "not_retryable" | "too_old" | "unavailable"; message: string; titles?: string[] };

class RetryRefusal extends Error {
  constructor(public readonly result: Extract<RetryResult, { ok: false }>) {
    super(result.message);
  }
}

/**
 * Makes an unpaid order payable again ("Try again" on the order page):
 *  - allowed for PENDING (payment not started / start failed) and for FAILED/EXPIRED/CANCELED-at-Mollie,
 *    never for orders canceled by the shop, archived, finalized or paid, and only within 72 h;
 *  - re-reserves every line for the order (all or nothing — if any item was sold or is held by someone
 *    else nothing changes and the customer is told which items);
 *  - resets paymentStatus to PENDING (event "payment.retry").
 * The caller then calls startOrderPayment.
 */
export async function retryOrderPayment(tenantId: string, uuid: string): Promise<RetryResult> {
  if (!uuidSchema.safeParse(uuid).success) return { ok: false, reason: "not_found", message: "Order not found" };
  const checkout = await getSettings(tenantId, "checkout");
  const hold = Math.max(PAYMENT_HOLD_MINUTES, checkout.reservationMinutes);
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM orders WHERE uuid = ${uuid}::uuid AND "tenantId" = ${tenantId} FOR UPDATE`;
      if (rows.length === 0) throw new RetryRefusal({ ok: false, reason: "not_found", message: "Order not found" });
      const order = await tx.order.findUniqueOrThrow({
        where: { id: rows[0].id },
        include: { lines: { select: { productId: true, title: true } } },
      });
      if (order.canceledAt || order.archivedAt || order.finalizedAt || !["PENDING", "FAILED", "EXPIRED", "CANCELED"].includes(order.paymentStatus)) {
        throw new RetryRefusal({ ok: false, reason: "not_retryable", message: "This order can no longer be paid" });
      }
      if (Date.now() - order.placedAt.getTime() > RETRY_WINDOW_MS) {
        throw new RetryRefusal({ ok: false, reason: "too_old", message: "This order is too old to pay. Please place a new order." });
      }

      const unavailable: string[] = [];
      const byProduct = [...new Map(order.lines.map((l) => [l.productId ?? `deleted:${l.title}`, l])).values()].sort((a, b) =>
        String(a.productId).localeCompare(String(b.productId)),
      );
      for (const line of byProduct) {
        if (!line.productId) {
          unavailable.push(line.title);
          continue;
        }
        const ok = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM products WHERE id = ${line.productId} AND "tenantId" = ${tenantId} AND status = 'ACTIVE' AND quantity > 0 FOR UPDATE`;
        if (ok.length === 0) {
          unavailable.push(line.title);
          continue;
        }
        try {
          await reserveProduct({ tenantId, productId: line.productId, orderId: order.id, minutes: hold }, tx);
        } catch (err) {
          if (err instanceof ServiceError && (err.code === "CONFLICT" || err.code === "NOT_FOUND")) unavailable.push(line.title);
          else throw err;
        }
      }
      if (unavailable.length) {
        throw new RetryRefusal({
          ok: false,
          reason: "unavailable",
          message: `Sorry — ${unavailable.join(", ")} ${unavailable.length > 1 ? "are" : "is"} no longer available, so this order can't be paid.`,
          titles: unavailable,
        });
      }
      // Existing holds of this order get the full payment window again.
      await tx.$executeRaw`
        UPDATE reservations SET "expiresAt" = GREATEST("expiresAt", now() + make_interval(mins => ${hold}::int)), "updatedAt" = now()
        WHERE "tenantId" = ${tenantId} AND "orderId" = ${order.id} AND status = 'ACTIVE'`;
      if (order.paymentStatus !== "PENDING") {
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PENDING" } });
        await tx.orderEvent.create({ data: { tenantId, orderId: order.id, type: "payment.retry", data: { from: order.paymentStatus } } });
      }
      return { ok: true as const, orderId: order.id };
    });
  } catch (err) {
    if (err instanceof RetryRefusal) return err.result;
    throw err;
  }
}

export const DEV_OUTCOMES = ["paid", "failed", "canceled", "expired"] as const;
export type DevOutcome = (typeof DEV_OUTCOMES)[number];

/**
 * DEVELOPMENT ONLY: pretends Mollie reported `outcome` for a PENDING order of a shop WITHOUT a Mollie key.
 * Creates a fake attempt (`tr_dev…`) and runs the real applyMolliePaymentStatus, i.e. exactly what the
 * webhook does. Refused in production and for shops that have a key (use Mollie test mode there).
 */
export async function simulateDevPayment(tenantId: string, uuid: string, outcome: DevOutcome) {
  if (!isDevSimulationAllowed()) throw new ServiceError("FORBIDDEN", "Not available");
  if (!(DEV_OUTCOMES as readonly string[]).includes(outcome)) throw new ServiceError("INVALID", "Unknown outcome");
  if (!uuidSchema.safeParse(uuid).success) throw new ServiceError("NOT_FOUND", "Order not found");
  if (await getMollieCredentials(tenantId)) throw new ServiceError("FORBIDDEN", "This shop has a Mollie key — use Mollie test mode");
  const order = await db.order.findFirst({ where: { uuid, tenantId }, select: { id: true, total: true, currency: true, paymentStatus: true, paymentMethod: true } });
  if (!order) throw new ServiceError("NOT_FOUND", "Order not found");
  if (order.paymentStatus !== "PENDING") throw new ServiceError("CONFLICT", "Only unpaid orders can be simulated");
  const providerPaymentId = `tr_dev${randomBytes(8).toString("hex")}`;
  await db.payment.create({
    data: {
      tenantId,
      orderId: order.id,
      provider: "MOLLIE",
      providerPaymentId,
      method: order.paymentMethod ?? "dev",
      status: "OPEN",
      amount: order.total,
      currency: order.currency,
      raw: { simulated: true },
    },
  });
  return applyMolliePaymentStatus(tenantId, providerPaymentId, outcome, { method: order.paymentMethod ?? "dev" });
}
