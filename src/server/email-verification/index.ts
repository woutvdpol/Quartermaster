import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { encrypt } from "@/server/auth/encryption";
import { generateToken, hashToken } from "@/server/auth/tokens";
import * as rateLimit from "@/server/auth/rate-limit";
import { queueMail } from "@/server/mail";
import { claimVerifiedEmailAndAudit } from "@/server/customer-auth/link";
import { EMAIL_VERIFICATION_TTL_HOURS } from "./config";

export { EMAIL_VERIFICATION_TTL_HOURS, VERIFY_EMAIL_PATH } from "./config";

/*
 * Customer e-mail verification (AuthToken type EMAIL_VERIFICATION).
 *
 *  - `sendCustomerVerification(tenantId, userId)` issues a fresh token (older unused ones are voided,
 *    only the newest link works) and queues the CustomerEmailVerification mail. Call it after
 *    registration and after an e-mail change (`registerCustomer` / `changeCustomerEmail`).
 *  - `verifyCustomerEmail(tenantId, token)` redeems a token on the shop that issued it: sets
 *    `User.emailVerifiedAt` and then links the guest data of the address to the account
 *    (customer-auth/link.ts `claimVerifiedEmail`). Tokens are bound to the address they were sent to, so changing the
 *    e-mail afterwards invalidates older links.
 */

/** At most 5 verification mails per account per hour (resend button abuse). */
export const VERIFICATION_RULE = { limit: 5, windowMs: 60 * 60 * 1000 };
const TTL_MS = EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000;

export type SendVerificationResult = { sent: true } | { sent: false; reason: "not_found" | "already_verified" | "rate_limited" };

export async function sendCustomerVerification(tenantId: string, userId: string): Promise<SendVerificationResult> {
  const user = await db.user.findFirst({
    where: { id: userId, tenantId, role: "CUSTOMER", disabledAt: null },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user) return { sent: false, reason: "not_found" };
  if (user.emailVerifiedAt) return { sent: false, reason: "already_verified" };

  const key = `verify-email:user:${user.id}`;
  if (!(await rateLimit.take(key, VERIFICATION_RULE))) return { sent: false, reason: "rate_limited" };

  const token = generateToken();
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.authToken.updateMany({ where: { userId: user.id, type: "EMAIL_VERIFICATION", usedAt: null }, data: { usedAt: now } });
    await tx.authToken.create({
      data: { userId: user.id, type: "EMAIL_VERIFICATION", tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + TTL_MS) },
    });
    await queueMail(
      { tenantId, template: "customer-email-verification", props: { userId: user.id, tokenEnc: encrypt(token) }, to: user.email },
      { tx },
    );
  });
  return { sent: true };
}

export type VerifyEmailResult = { ok: true; email: string } | { ok: false; error: "invalid_token" };

export async function verifyCustomerEmail(tenantId: string, token: string): Promise<VerifyEmailResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return { ok: false, error: "invalid_token" };
  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, tenantId: true, role: true, email: true, disabledAt: true, emailVerifiedAt: true } } },
  });
  if (
    !row ||
    row.type !== "EMAIL_VERIFICATION" ||
    row.usedAt ||
    row.expiresAt.getTime() <= Date.now() ||
    row.user.tenantId !== tenantId ||
    row.user.role !== "CUSTOMER" ||
    row.user.disabledAt ||
    // The address changed after this link was sent: the old mailbox must not verify the new one.
    (await emailChangedSince(tenantId, row.user.id, row.createdAt))
  ) {
    return { ok: false, error: "invalid_token" };
  }
  const claimed = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return { ok: false, error: "invalid_token" };
  if (!row.user.emailVerifiedAt) {
    await db.user.update({ where: { id: row.user.id }, data: { emailVerifiedAt: new Date() } });
    await audit({ action: "customer.email_verified", tenantId, actorId: row.user.id, entity: "User", entityId: row.user.id });
  }
  // The address is proven now: only now may the guest data of this address join the account
  // (guest Customer, its orders, addresses, …) — security review R1. Never fail the verification over it.
  await claimVerifiedEmailAndAudit(tenantId, row.user.id).catch((e) => console.error("verifyCustomerEmail: claim failed", e));
  return { ok: true, email: row.user.email };
}

/**
 * Whether the customer changed their e-mail after `since` (audit "customer.email_changed").
 * changeCustomerEmail() does not void verification tokens itself; this keeps old links harmless.
 * Uses the (tenantId, createdAt) index: only entries newer than the token are scanned.
 */
async function emailChangedSince(tenantId: string, userId: string, since: Date): Promise<boolean> {
  const entry = await db.auditLog.findFirst({
    where: { tenantId, createdAt: { gte: since }, actorId: userId, action: "customer.email_changed" },
    select: { id: true },
  });
  return entry !== null;
}

/** Whether a user's e-mail address is confirmed. */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  return !!user?.emailVerifiedAt;
}
