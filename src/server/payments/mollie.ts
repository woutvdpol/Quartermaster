import "server-only";
import { z } from "zod";
import { MollieApiError, type Payment as MolliePayment, type PaymentMethod } from "@mollie/api-client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { applyMolliePaymentStatus, type ApplyMollieResult } from "@/server/orders/commands";
import { isFinalAttemptStatus, isMollieStatus, mollieToAttemptStatus } from "@/server/orders/mollie-status";
import { audit } from "@/server/audit";
import { take } from "@/server/auth/rate-limit";
import { getMollieCredentials, mapMollieError, mollieClient } from "./mollie-config";
import { toMollieAmount } from "./settings";
import { verifyMolliePayment, type Mismatch, type MismatchReason } from "./verify";

/*
 * Mollie payments: start a payment for an order, and process webhooks.
 *
 * Webhook contract (Mollie posts only `id`): we NEVER trust anything but the id; the status is always
 * re-fetched from Mollie with the tenant's own key, verified against our Payment/Order rows (amount,
 * currency, mode, metadata — security review R3) and only then mapped onto the order by
 * orders/commands.applyMolliePaymentStatus (idempotent, row-locked). Mollie calls are limited per
 * tenant (R4, see WEBHOOK_RULES).
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

  // Local development: Mollie rejects webhook URLs it cannot reach (localhost). Create the payment
  // without one; the order page then pulls the status (syncLocalMolliePayment). Never in production.
  const localWebhook = process.env.NODE_ENV !== "production" && isLocalUrl(webhookUrl);
  const client = mollieClient(creds.apiKey);
  let mp: MolliePayment;
  try {
    mp = await client.payments.create({
      amount: toMollieAmount(row.total, row.currency),
      description: `Order ${row.number}`,
      redirectUrl,
      cancelUrl,
      webhookUrl: localWebhook ? undefined : webhookUrl,
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
  /** The fetched payment doesn't match our records (R3): nothing applied, `payment.mismatch` recorded. */
  | { outcome: "mismatch"; reasons: MismatchReason[] }
  /** Per-tenant webhook budget exhausted (R4): nothing fetched; the route answers 503 so Mollie retries later. */
  | { outcome: "throttled" }
  | { outcome: "ignored"; reason: "INVALID_ID" | "NOT_CONFIGURED" | "UNKNOWN_PAYMENT" | "UNKNOWN_STATUS" | "FINAL" };

/** Thrown for failures Mollie should retry (route answers 500). */
export class MollieWebhookRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MollieWebhookRetryableError";
  }
}

const PAYMENT_ID_RE = /^tr_[A-Za-z0-9]{4,40}$/;

/*
 * R4 — the webhook is unauthenticated, and every Mollie call uses (and counts against) the tenant's own
 * API key. Before calling Mollie:
 *  - the id must belong to a Payment row of THIS tenant whose attempt is not final yet (final attempts
 *    can't change any more → answered without a Mollie call);
 *  - ids we don't know (normally only the tiny race where Mollie calls before our Payment insert has
 *    committed) get a small per-tenant budget;
 *  - known ids share a generous per-tenant budget (a few webhooks per payment is normal).
 * Over budget → "throttled" (503): a genuine Mollie webhook is retried later, an attacker burns nothing.
 */
export const WEBHOOK_RULES = {
  knownPerTenant: { limit: 600, windowMs: 10 * 60 * 1000 },
  unknownPerTenant: { limit: 30, windowMs: 10 * 60 * 1000 },
} as const;

/**
 * Processes a Mollie webhook for a tenant. Returns "ignored" for ids we don't know or can't use (→ 200, no
 * retries), "mismatch" when Mollie's payment doesn't match our records (→ 200, see recordMismatch),
 * "throttled" over the per-tenant budget (→ 503), and throws MollieWebhookRetryableError for transient
 * problems (Mollie/DB unavailable → 500, Mollie retries).
 */
export async function handleMollieWebhook(tenantId: string, providerPaymentId: string): Promise<MollieWebhookOutcome> {
  const id = typeof providerPaymentId === "string" ? providerPaymentId.trim() : "";
  if (!PAYMENT_ID_RE.test(id)) return { outcome: "ignored", reason: "INVALID_ID" };

  const creds = await getMollieCredentials(tenantId);
  if (!creds) return { outcome: "ignored", reason: "NOT_CONFIGURED" };

  const row = await db.payment.findFirst({
    where: { tenantId, providerPaymentId: id, provider: "MOLLIE" },
    select: { id: true, orderId: true, status: true, amount: true, currency: true, order: { select: { total: true, currency: true } } },
  });
  if (row && isFinalAttemptStatus(row.status)) return { outcome: "ignored", reason: "FINAL" };

  const allowed = row
    ? await take(`mollie.webhook:${tenantId}`, WEBHOOK_RULES.knownPerTenant)
    : await take(`mollie.webhook.unknown:${tenantId}`, WEBHOOK_RULES.unknownPerTenant);
  if (!allowed) {
    console.warn(`[mollie] ${tenantId}: webhook budget exhausted (${row ? "known" : "unknown"} ids) — not calling Mollie for ${id}`);
    return { outcome: "throttled" };
  }

  let mp: MolliePayment;
  try {
    mp = await mollieClient(creds.apiKey).payments.get(id);
  } catch (err) {
    if (err instanceof MollieApiError && (err.statusCode === 404 || err.statusCode === 410)) {
      return { outcome: "ignored", reason: "UNKNOWN_PAYMENT" };
    }
    throw new MollieWebhookRetryableError(`Fetching Mollie payment failed (${err instanceof MollieApiError ? (err.statusCode ?? "network") : "error"})`, { cause: err });
  }

  if (!row) return unknownPayment(tenantId, mp);

  if (!isMollieStatus(mp.status)) {
    console.warn(`[mollie] ${tenantId}: payment ${id} has unsupported status "${mp.status}"`);
    return { outcome: "ignored", reason: "UNKNOWN_STATUS" };
  }

  const mismatches = verifyMolliePayment(mp, {
    providerPaymentId: id,
    amount: row.amount,
    currency: row.currency,
    orderTotal: row.order.total,
    orderCurrency: row.order.currency,
    mode: creds.mode,
    tenantId,
    orderId: row.orderId,
  });
  if (mismatches.length) {
    await recordMismatch(tenantId, row.orderId, id, mp.status, mismatches);
    return { outcome: "mismatch", reasons: mismatches.map((m) => m.reason) };
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
    if (err instanceof ServiceError && err.code === "NOT_FOUND") return { outcome: "ignored", reason: "UNKNOWN_PAYMENT" };
    if (err instanceof ServiceError && err.code === "INVALID") return { outcome: "ignored", reason: "UNKNOWN_STATUS" };
    throw new MollieWebhookRetryableError("Applying payment status failed", { cause: err });
  }
}

/**
 * Mollie knows the payment but we have no row for this tenant. If it was created for one of this
 * tenant's orders, our Payment insert hasn't committed yet (webhook raced createMolliePayment) → let
 * Mollie retry. Anything else (another shop's payment, a guessed id) is ignored.
 */
async function unknownPayment(tenantId: string, mp: MolliePayment): Promise<MollieWebhookOutcome> {
  const meta = (mp.metadata ?? {}) as { tenantId?: unknown; orderId?: unknown };
  if (meta.tenantId === tenantId && typeof meta.orderId === "string") {
    const order = await db.order.findFirst({ where: { id: meta.orderId, tenantId }, select: { id: true } });
    if (order) throw new MollieWebhookRetryableError("Payment row not stored yet");
  }
  return { outcome: "ignored", reason: "UNKNOWN_PAYMENT" };
}

/**
 * R3: Mollie returned a payment that doesn't match what we created (amount/currency, test vs live mode,
 * metadata, id). The order is NOT changed. We record it once per payment (order timeline event
 * `payment.mismatch` + audit entry) and log it; the webhook still answers 200 because re-fetching gives
 * the same answer — retries would only burn the tenant's Mollie quota. Staff resolve it by hand (check
 * the payment in the Mollie dashboard, then "mark as paid" or refund).
 */
async function recordMismatch(tenantId: string, orderId: string, paymentId: string, mollieStatus: string, mismatches: Mismatch[]) {
  const reasons = mismatches.map((m) => m.reason);
  console.error(`[mollie] ${tenantId}: payment ${paymentId} does not match order ${orderId} (${reasons.join(", ")}) — not applied`);
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qm:paymismatch:${paymentId}`}))`;
    const existing = await tx.orderEvent.findFirst({
      where: { tenantId, orderId, type: "payment.mismatch", data: { path: ["paymentId"], equals: paymentId } },
      select: { id: true },
    });
    if (existing) return false;
    await tx.orderEvent.create({
      data: { tenantId, orderId, type: "payment.mismatch", data: { provider: "MOLLIE", paymentId, mollieStatus, reasons, details: mismatches } },
    });
    return true;
  });
  if (created) {
    await audit({ action: "payment.mismatch", tenantId, entity: "Order", entityId: orderId, data: { provider: "MOLLIE", paymentId, mollieStatus, reasons } });
  }
}

function isLocalUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * Development only: without a reachable webhook, pull the latest Mollie status for an order's open
 * payments and apply it exactly like the webhook would. No-op in production.
 */
export async function syncLocalMolliePayment(tenantId: string, orderId: string): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return false;
  const open = await db.payment.findMany({
    where: { tenantId, orderId, provider: "MOLLIE", status: { in: ["OPEN", "PENDING", "AUTHORIZED"] } },
    select: { providerPaymentId: true },
  });
  let changed = false;
  for (const p of open) {
    if (!p.providerPaymentId) continue;
    // Same path as the webhook, so the same R3 verification (amount/currency/mode/metadata) and R4 budget apply.
    const outcome = await handleMollieWebhook(tenantId, p.providerPaymentId).catch(() => null);
    if (outcome?.outcome === "processed" && outcome.result.changed) changed = true;
  }
  return changed;
}
