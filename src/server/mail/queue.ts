import "server-only";
import { db } from "@/server/db";
import { encrypt } from "@/server/auth/encryption";
import { requestPasswordReset } from "@/server/auth/service";
import { RULES, take } from "@/server/auth/rate-limit";
import { requestClientIp } from "@/server/request-meta";
import { enqueue, type EnqueueOptions } from "@/server/jobs/queue";
import type { MailTemplateName, MailTemplateProps } from "./contracts";

export type QueueMailInput<T extends MailTemplateName> = {
  tenantId: string | null;
  template: T;
  props: MailTemplateProps<T>;
  /** Required for templates that don't derive the recipient (password-reset, campaign test). */
  to?: string;
};

/**
 * Queues a templated mail (`mail.send` job). Rendering and sending happen in the worker with
 * retries + exponential backoff. Pass `{ tx }` to queue inside a Prisma transaction.
 */
export async function queueMail<T extends MailTemplateName>(input: QueueMailInput<T>, opts: Pick<EnqueueOptions, "tx" | "startAfter"> = {}) {
  return enqueue(
    "mail.send",
    { tenantId: input.tenantId, template: input.template, props: input.props as Record<string, unknown>, to: input.to },
    opts,
  );
}

/**
 * Queues the order confirmation to the customer and the notification to the shop owner — once per
 * order: `Order.confirmationSentAt` is claimed in the same transaction that queues the jobs, so a
 * repeated call (webhook retry, finalizer re-run) is a no-op. Returns false when already queued.
 *
 * Call it after the order is finalized; pass the finalizer's `tx` to make it part of that transaction.
 * The mails load the order when they are sent, so they show its state at that moment.
 */
export async function queueOrderConfirmation(tenantId: string, orderId: string, opts: Pick<EnqueueOptions, "tx"> = {}): Promise<boolean> {
  const run = async (tx: NonNullable<EnqueueOptions["tx"]>) => {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, tenantId, confirmationSentAt: null },
      data: { confirmationSentAt: new Date() },
    });
    if (claimed.count === 0) return false;
    await queueMail({ tenantId, template: "order-confirmation-customer", props: { orderId } }, { tx });
    await queueMail({ tenantId, template: "order-confirmation-owner", props: { orderId } }, { tx });
    return true;
  };
  return opts.tx ? run(opts.tx) : db.$transaction(run);
}

/** Queues a password-reset mail for a raw token from `requestPasswordReset()`. The token is encrypted in the job. */
export async function queuePasswordResetMail(input: {
  tenantId: string | null;
  email: string;
  token: string;
  audience: "admin" | "customer";
}) {
  return queueMail({
    tenantId: input.tenantId,
    template: "password-reset",
    props: { tokenEnc: encrypt(input.token), audience: input.audience },
    to: input.email,
  });
}

/**
 * "Forgot password" entry point for the admin and shop actions. Always does the same work — an
 * optional per-IP limit and ONE job insert — whether or not the address has an account, so the
 * response and its timing reveal nothing (security backlog #8). The lookup, token and mail happen
 * in the `auth.password-reset.request` job (`processPasswordResetRequest`).
 */
export async function requestPasswordResetEmail(tenantId: string | null, email: string, audience: "admin" | "customer"): Promise<void> {
  const normalized = email.trim().toLowerCase().slice(0, 254);
  if (!normalized) return;
  const ip = await requestClientIp();
  if (ip && !(await take(`reset:ip:${ip}`, RULES.passwordResetPerIp))) return;
  await enqueue("auth.password-reset.request", { tenantId, email: normalized, audience });
}

/** Worker side of `requestPasswordResetEmail`: `requestPasswordReset()` + mail when a token was issued. */
export async function processPasswordResetRequest(tenantId: string | null, email: string, audience: "admin" | "customer"): Promise<void> {
  const token = await requestPasswordReset(tenantId, email);
  if (!token) return;
  await queuePasswordResetMail({ tenantId, email: email.trim().toLowerCase(), token, audience });
}
