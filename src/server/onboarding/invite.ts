import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { encrypt } from "@/server/auth/encryption";
import { hashPassword } from "@/server/auth/password";
import { newPasswordSchema } from "@/server/auth/service";
import { createSession, destroyAllSessions } from "@/server/auth/session";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { take } from "@/server/auth/rate-limit";
import { queueMail } from "@/server/mail/queue";
import type { Prisma } from "@/generated/prisma/client";
import { DEALER_INVITE_TTL_HOURS } from "./rules";

/*
 * Owner invites for approved dealer applications. Unlike the staff invite in src/server/users (a
 * 7-day PASSWORD_RESET token redeemed on the reset page), these are AuthToken type INVITE with a 24 h
 * lifetime, redeemed on /admin/accept-invite which signs the owner in and opens the setup wizard.
 * Only the newest invite of a user works (issuing one voids older unused ones).
 */

type Tx = Prisma.TransactionClient;

export const DEALER_INVITE_TTL_MS = DEALER_INVITE_TTL_HOURS * 60 * 60 * 1000;
const ACCEPT_RULE_PER_IP = { limit: 20, windowMs: 60 * 60 * 1000 };

/** New INVITE token for `userId` (older unused ones voided) + the invite mail, both inside `tx`. */
export async function issueDealerInvite(tx: Tx, input: { tenantId: string; userId: string }) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEALER_INVITE_TTL_MS);
  await tx.authToken.updateMany({ where: { userId: input.userId, type: "INVITE", usedAt: null }, data: { usedAt: now } });
  await tx.authToken.create({ data: { userId: input.userId, type: "INVITE", tokenHash: hashToken(token), expiresAt } });
  // The raw token travels encrypted in the job; the builder re-checks it is still the live invite.
  await queueMail({ tenantId: input.tenantId, template: "dealer-invite", props: { userId: input.userId, tokenEnc: encrypt(token) } }, { tx });
  return { token, expiresAt };
}

export type AcceptInviteResult =
  | { ok: true; userId: string }
  | { ok: false; error: "invalid_token" | "invalid_password" | "rate_limited"; message?: string };

/**
 * Redeems an INVITE token on the shop's host (`scope.tenantId`): sets the first password, marks the
 * e-mail verified (the link went to that mailbox) and signs the owner in. Tokens of another host,
 * used/expired/superseded tokens and owners who already chose a password → invalid_token.
 */
export async function acceptDealerInvite(
  token: string,
  password: string,
  scope: { tenantId: string; ip?: string | null },
): Promise<AcceptInviteResult> {
  const pw = newPasswordSchema.safeParse(password);
  if (!pw.success) return { ok: false, error: "invalid_password", message: pw.error.issues[0]?.message };
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return { ok: false, error: "invalid_token" };
  if (!(await take(`invite-accept:ip:${scope.ip ?? "unknown"}`, ACCEPT_RULE_PER_IP))) return { ok: false, error: "rate_limited" };

  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, tenantId: true, role: true, passwordHash: true, disabledAt: true, emailVerifiedAt: true } } },
  });
  if (
    !row ||
    row.type !== "INVITE" ||
    row.usedAt ||
    row.expiresAt.getTime() <= Date.now() ||
    row.user.disabledAt ||
    row.user.role !== "OWNER" ||
    row.user.tenantId !== scope.tenantId ||
    row.user.passwordHash !== null
  ) {
    return { ok: false, error: "invalid_token" };
  }

  const passwordHash = await hashPassword(pw.data);
  const now = new Date();
  const claimed = await db.$transaction(async (tx) => {
    // Claim atomically: two concurrent submissions cannot both succeed.
    const { count } = await tx.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (count !== 1) return false;
    const updated = await tx.user.updateMany({
      where: { id: row.userId, passwordHash: null },
      data: { passwordHash, lastLoginAt: now, ...(row.user.emailVerifiedAt ? {} : { emailVerifiedAt: now }) },
    });
    if (updated.count !== 1) throw new Error("invite-race"); // rolls back the claim
    // Any other outstanding invite/reset link is now pointless.
    await tx.authToken.updateMany({ where: { userId: row.userId, usedAt: null, type: { in: ["INVITE", "PASSWORD_RESET"] } }, data: { usedAt: now } });
    return true;
  }).catch((err) => {
    if (err instanceof Error && err.message === "invite-race") return false;
    throw err;
  });
  if (!claimed) return { ok: false, error: "invalid_token" };

  await destroyAllSessions(row.userId);
  await createSession(row.userId, "OWNER");
  await audit({ action: "auth.invite_accepted", tenantId: scope.tenantId, actorId: row.userId, entity: "User", entityId: row.userId });
  return { ok: true, userId: row.userId };
}

/** Read-only look at an invite (for the accept page): the account e-mail when the token is still usable here. */
export async function peekDealerInvite(token: string, tenantId: string): Promise<{ email: string } | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return null;
  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { type: true, usedAt: true, expiresAt: true, user: { select: { email: true, tenantId: true, role: true, passwordHash: true, disabledAt: true } } },
  });
  const usable =
    row &&
    row.type === "INVITE" &&
    !row.usedAt &&
    row.expiresAt.getTime() > Date.now() &&
    row.user.role === "OWNER" &&
    row.user.tenantId === tenantId &&
    row.user.passwordHash === null &&
    !row.user.disabledAt;
  return usable ? { email: row.user.email } : null;
}
