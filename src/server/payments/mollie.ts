import "server-only";
import { z } from "zod";
import { MollieApiError, type Payment as MolliePayment, type PaymentMethod } from "@mollie/api-client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { applyMolliePaymentStatus, type ApplyMollieResult } from "@/server/orders/commands";
import { isMollieStatus, mollieToAttemptStatus } from "@/server/orders/mollie-status";
import { getMollieCredentials, mapMollieError, mollieClient } from "./mollie-config";
import { toMollieAmount } from "./settings";

/*
 * Mollie payments: start a payment for an order, and process webhooks.
 *
 * Webhook contract (Mollie posts only `id`): we NEVER trust anything but the id; the status is always
 * re-fetched from Mollie with the tenant's own key, and status → order mapping is delegated to
 * orders/commands.applyMolliePaymentStatus (idempotent, row-locked).
 */

const urlSchema = z.url({ protocol: /^https?$/ }).max(2000);
const createOptionsSchema = z.object({
  redirectUrl: urlSchema,
  webhookUrl: urlSchema,
  cancelUrl: urlSchema.optional(),
  /** Pre-selected method (checkout method picker); must be one of the tenant's enabled methods. */
  method: z.string().trim().toLowerCase().min(1).max(40).optional(),
  locale: z.string().regex(/^[a-z]{2}_[A-Z]{2}$/).optional(),
});
export type CreateMolliePaymentOptions = z.input<typeof createOptionsSchema>;

export type CreatedMolliePayment = {
  paymentId: string;
  providerPaymentId: string;
  checkoutUrl: string | null;
  status: string;
};

const PAYABLE_ORDER_STATUSES = new Set(["PENDING"]);

/** The subset of a Mollie payment we keep in Payment.raw (no `details`: those hold consumer name/IBAN). */
function slimPayload(p: MolliePayment): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({
      id: p.id,
      mode: p.mode,
      status: p.status,
      method: p.method ?? null,
      amount: p.amount,
      amountRefunded: p.amountRefunded ?? null,
      amountRemaining: p.amountRemaining ?? null,
      createdAt: p.createdAt,
      paidAt: p.paidAt ?? null,
      expiresAt: p.expiresAt ?? null,
      canceledAt: p.canceledAt ?? null,
      failedAt: p.failedAt ?? null,
      expiredAt: p.expiredAt ?? null,
      statusReason: p.statusReason ?? null,
      metadata: p.metadata ?? null,
    }),
  );
}

const toDate = (s: string | undefined | null) => (s ? new Date(s) : null);

/**
 * Starts a Mollie payment for an order: amount/currency are read from the order row (never from the
 * caller), the Mollie payment is created with the tenant's key, and a Payment attempt row is stored
 * with the provider id, checkout URL and Mollie's initial status (normally "open" → OPEN).
 * Only orders whose paymentStatus is PENDING and that aren't canceled/archived can be paid.
 */
export async function createMolliePayment(
  tenantId: string,
  order: { id: string },
  options: CreateMolliePaymentOptions,
): Promise<CreatedMolliePayment> {
  const opts = createOptionsSchema.safeParse(options);
  if (!opts.success) throw new ServiceError("INVALID", opts.error.issues[0]?.message ?? "Invalid options");
  const { redirectUrl, webhookUrl, cancelUrl, method, locale } = opts.data;

  const creds = await getMollieCredentials(tenantId);
  if (!creds) throw new ServiceError("UNAVAILABLE", "Online payment is not configured for this shop");

  const row = await db.order.findFirst({
    where: { id: String(order?.id ?? ""), tenantId },
    select: { id: true, number: true, total: true, currency: true, paymentStatus: true, canceledAt: true, archivedAt: true },
  });
  if (!row) throw new ServiceError("NOT_FOUND", "Order not found");
  if (row.canceledAt || row.archivedAt || !PAYABLE_ORDER_STATUSES.has(row.paymentStatus)) {
    throw new ServiceError("CONFLICT", "This order can no longer be paid");
  }
  if (row.total <= 0) throw new ServiceError("INVALID", "Order total must be positive");

  const enabled = creds.enabledMethods;
  if (method && enabled.length && !enabled.includes(method)) throw new ServiceError("INVALID", "This payment method is not available");
  const methodParam = method ?? (enabled.length ? enabled : undefined);

  const client = mollieClient(creds.apiKey);
  let mp: MolliePayment;
  try {
    mp = await client.payments.create({
      amount: toMollieAmount(row.total, row.currency),
      description: `Order ${row.number}`,
      redirectUrl,
      cancelUrl,
      webhookUrl,
      locale: locale as never,
      method: methodParam as PaymentMethod | PaymentMethod[] | undefined,
      metadata: { tenantId, orderId: row.id, orderNumber: row.number },
    });
  } catch (err) {
    throw mapMollieError(err, "creating payment");
  }

  try {
    const payment = await db.payment.create({
      data: {
        tenantId,
        orderId: row.id,
        provider: "MOLLIE",
        providerPaymentId: mp.id,
        method: (mp.method as string | undefined) ?? null,
        status: isMollieStatus(mp.status) ? mollieToAttemptStatus(mp.status) : "OPEN",
        amount: row.total,
        currency: row.currency,
        checkoutUrl: mp.getCheckoutUrl() ?? null,
        expiresAt: toDate(mp.expiresAt),
        raw: slimPayload(mp),
      },
    });
    return { paymentId: payment.id, providerPaymentId: mp.id, checkoutUrl: payment.checkoutUrl, status: payment.status };
  } catch (err) {
    // Don't leave a payable Mollie payment we can't track.
    await client.payments.cancel(mp.id).catch(() => undefined);
    throw err;
  }
}

export type MollieWebhookOutcome =
  | { outcome: "processed"; result: ApplyMollieResult }
  | { outcome: "ignored"; reason: "INVALID_ID" | "NOT_CONFIGURED" | "UNKNOWN_PAYMENT" | "UNKNOWN_STATUS" };

/** Thrown for failures Mollie should retry (route answers 500). */
export class MollieWebhookRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MollieWebhookRetryableError";
  }
}

const PAYMENT_ID_RE = /^tr_[A-Za-z0-9]{4,40}$/;

/**
 * Processes a Mollie webhook for a tenant. Returns "ignored" for ids we don't know (→ 200, no retries);
 * throws MollieWebhookRetryableError for transient problems (Mollie/DB unavailable → 500, Mollie retries).
 */
export async function handleMollieWebhook(tenantId: string, providerPaymentId: string): Promise<MollieWebhookOutcome> {
  const id = typeof providerPaymentId === "string" ? providerPaymentId.trim() : "";
  if (!PAYMENT_ID_RE.test(id)) return { outcome: "ignored", reason: "INVALID_ID" };

  const creds = await getMollieCredentials(tenantId);
  if (!creds) return { outcome: "ignored", reason: "NOT_CONFIGURED" };

  let mp: MolliePayment;
  try {
    mp = await mollieClient(creds.apiKey).payments.get(id);
  } catch (err) {
    if (err instanceof MollieApiError && (err.statusCode === 404 || err.statusCode === 410)) {
      return { outcome: "ignored", reason: "UNKNOWN_PAYMENT" };
    }
    throw new MollieWebhookRetryableError(`Fetching Mollie payment failed (${err instanceof MollieApiError ? (err.statusCode ?? "network") : "error"})`, { cause: err });
  }

  if (!isMollieStatus(mp.status)) {
    console.warn(`[mollie] ${tenantId}: payment ${id} has unsupported status "${mp.status}"`);
    return { outcome: "ignored", reason: "UNKNOWN_STATUS" };
  }

  try {
    const result = await applyMolliePaymentStatus(tenantId, mp.id, mp.status, {
      method: (mp.method as string | undefined) ?? null,
      raw: slimPayload(mp),
      paidAt: toDate(mp.paidAt),
      expiresAt: toDate(mp.expiresAt),
    });
    return { outcome: "processed", result };
  } catch (err) {
    if (err instanceof ServiceError && err.code === "NOT_FOUND") {
      // Mollie knows the payment but we have no row. If it was created for one of this tenant's orders,
      // our Payment insert hasn't committed yet (webhook raced createMolliePayment) → let Mollie retry.
      const meta = (mp.metadata ?? {}) as { tenantId?: unknown; orderId?: unknown };
      if (meta.tenantId === tenantId && typeof meta.orderId === "string") {
        const order = await db.order.findFirst({ where: { id: meta.orderId, tenantId }, select: { id: true } });
        if (order) throw new MollieWebhookRetryableError("Payment row not stored yet", { cause: err });
      }
      return { outcome: "ignored", reason: "UNKNOWN_PAYMENT" };
    }
    if (err instanceof ServiceError && err.code === "INVALID") return { outcome: "ignored", reason: "UNKNOWN_STATUS" };
    throw new MollieWebhookRetryableError("Applying payment status failed", { cause: err });
  }
}
