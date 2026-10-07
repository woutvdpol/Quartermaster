import "server-only";
import { requestClientIp } from "@/server/request-meta";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { Role } from "@/generated/prisma/enums";
import { decrypt, encrypt } from "./encryption";
import {
  getDummyHash,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  verifyPassword,
} from "./password";
import { claimVerifiedEmailAndAudit } from "@/server/customer-auth/link";
import { isLegacyBcrypt } from "./legacy-bcrypt";
import * as rateLimit from "./rate-limit";
import { BACKOFF, RULES } from "./rate-limit";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  getSession,
  promoteSession,
  type SessionUser,
} from "./session";
import { generateRecoveryCode, generateToken, hashRecoveryCode, hashToken, recoveryCodeLookupHashes } from "./tokens";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";

/*
 * Auth use-cases. All business rules for signing in, 2FA and passwords live here;
 * route handlers / server actions only parse form data, call these, and render the result.
 *
 * Design notes
 * - Login never reveals whether an account exists: unknown users still pay for a scrypt
 *   verification (dummy hash) and get the same "invalid_credentials" error. "disabled" is only
 *   returned after the correct password was given.
 * - Brute force: exponential backoff per account key and per IP (rate-limit.ts BACKOFF), no hard
 *   lock-out. The account key is derived from the submitted email, so unknown emails back off
 *   exactly like real ones. Attempts are recorded atomically BEFORE the password is checked.
 * - Legacy hashes (`bcrypt$…` from the Concept500 import) and scrypt hashes with old parameters are
 *   replaced by a current scrypt hash after every successful password check: login (admin + shop,
 *   which delegates here) and re-authentication (`verifyCurrentPassword`, used by TOTP disable,
 *   password/email change, account deletion and the staff profile). Password reset writes a new hash.
 * - TOTP enrollment stores nothing until confirmed: `startTotpEnrollment` returns a fresh secret
 *   that the caller round-trips (e.g. hidden form field) to `confirmTotpEnrollment`. The secret is
 *   already shown to the user as a QR code, so round-tripping it adds no exposure, and an abandoned
 *   enrollment leaves no state behind. Confirm only succeeds with a valid code for that secret.
 * - TOTP replay protection: the schema has no "last used step" column, so a used (user, step) pair is
 *   recorded as a RateLimitHit row ("totp:used:<userId>:<step>") and checked before accepting a code.
 *   Those rows are pruned by `pruneRateLimitHits` after 24 h, far beyond the ±1 step window.
 */

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const TOTP_REPLAY_RULE = { limit: 1, windowMs: 10 * 60 * 1000 };

// ─── Validation ─────────────────────────────────────────────────────────────

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
/** Any password the user may *submit* (login, current password). */
const submittedPasswordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);
/** Rules for a password the user *chooses*. */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
const tenantIdSchema = z.string().min(1).nullable();

const loginSchema = z.object({
  email: emailSchema,
  password: submittedPasswordSchema,
  tenantId: tenantIdSchema,
  ip: z.string().max(100).nullable().optional(),
});

const totpCodeSchema = z.string().trim().min(1).max(32);
const totpSecretSchema = z.string().regex(/^[A-Z2-7]{32}$/, "Invalid TOTP secret");

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Finds the account an email signs in to on a given host:
 * the platform host (tenantId null) only knows SUPERADMINs, a tenant host only its OWNER/CUSTOMERs.
 */
async function findAccount(tenantId: string | null, email: string) {
  if (tenantId === null) {
    return db.user.findFirst({ where: { tenantId: null, email, role: "SUPERADMIN" } });
  }
  const user = await db.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
  return user && (user.role === "OWNER" || user.role === "CUSTOMER") ? user : null;
}

const keys = {
  loginIp: (ip: string) => `login:ip:${ip}`,
  loginAccount: (tenantId: string | null, email: string) => `login:email:${tenantId ?? "platform"}:${email}`,
  totpSession: (sessionId: string) => `totp:session:${sessionId}`,
  totpUser: (userId: string) => `totp:user:${userId}`,
  totpUsed: (userId: string, step: number) => `totp:used:${userId}:${step}`,
  reauth: (userId: string) => `reauth:user:${userId}`,
  reset: (tenantId: string | null, email: string) => `reset:email:${tenantId ?? "platform"}:${email}`,
};

/** Verifies a TOTP code and rejects reuse of a step that was already accepted for this user. */
async function acceptTotp(userId: string, secretBase32: string, code: string): Promise<boolean> {
  const step = verifyTotp(secretBase32, code);
  if (step === null) return false;
  // Atomic "first use wins": two concurrent submissions of one code can't both pass.
  return rateLimit.take(keys.totpUsed(userId, step), TOTP_REPLAY_RULE);
}

/**
 * Consumes an unused recovery code. Looks up the HMAC form and, for codes issued before the HMAC
 * switch, the legacy SHA-256 form. The conditional update makes concurrent use of one code fail.
 */
async function consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
  const hashes = recoveryCodeLookupHashes(input);
  if (hashes.length === 0) return false;
  const row = await db.recoveryCode.findFirst({ where: { userId, codeHash: { in: hashes }, usedAt: null } });
  if (!row) return false;
  const { count } = await db.recoveryCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

/**
 * After a successful password check: replace a legacy (bcrypt) or outdated scrypt hash with a
 * current scrypt hash. Conditional on the stored hash being unchanged, so it never overwrites a
 * password that was reset/changed concurrently.
 */
async function upgradePasswordHash(user: { id: string; tenantId: string | null }, password: string, stored: string) {
  if (!needsRehash(stored)) return;
  const { count } = await db.user.updateMany({
    where: { id: user.id, passwordHash: stored },
    data: { passwordHash: await hashPassword(password) },
  });
  if (count === 1 && isLegacyBcrypt(stored)) {
    await audit({ action: "auth.password_rehashed", tenantId: user.tenantId, actorId: user.id, data: { from: "bcrypt" } });
  }
}

/**
 * Re-authentication with the current password for sensitive changes (TOTP disable, password/email
 * change, account deletion, staff profile). Backoff per user; rehashes legacy hashes on success.
 */
export async function verifyCurrentPassword(userId: string, password: unknown): Promise<"ok" | "invalid" | "rate_limited"> {
  const parsed = submittedPasswordSchema.safeParse(password);
  const key = keys.reauth(userId);
  const allowed = await rateLimit.attempt(key, BACKOFF.reauth);
  if (!allowed.allowed) return "rate_limited";
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true, tenantId: true } });
  const ok = await verifyPassword(parsed.success ? parsed.data : "", user?.passwordHash ?? (await getDummyHash()));
  if (!ok || !user?.passwordHash || !parsed.success) return "invalid"; // the attempt stays counted
  await rateLimit.clear(key);
  await upgradePasswordHash({ id: userId, tenantId: user.tenantId }, parsed.data, user.passwordHash);
  return "ok";
}

// ─── Login ──────────────────────────────────────────────────────────────────

export type LoginResult =
  | { ok: true; next: "done" | "totp" }
  | { ok: false; error: "invalid_credentials" | "rate_limited" | "disabled" };

export async function login(input: {
  email: string;
  password: string;
  tenantId: string | null;
  /** Client IP; read from request headers when omitted. */
  ip?: string | null;
}): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_credentials" };
  const { email, password, tenantId } = parsed.data;
  const ip = parsed.data.ip !== undefined ? parsed.data.ip : await requestClientIp();

  // Record the attempt atomically before checking anything (see rate-limit.ts). The account key
  // depends only on the submitted email, so it behaves the same for unknown accounts.
  const accountKey = keys.loginAccount(tenantId, email);
  const accountTry = await rateLimit.attempt(accountKey, BACKOFF.loginPerAccount);
  const ipTry = accountTry.allowed && ip ? await rateLimit.attempt(keys.loginIp(ip), BACKOFF.loginPerIp) : null;
  if (!accountTry.allowed || (ipTry && !ipTry.allowed)) {
    await rateLimit.release(accountTry); // never checked, so don't count it
    await audit({ action: "auth.login_failed", tenantId, data: { email, reason: "rate_limited" } });
    return { ok: false, error: "rate_limited" };
  }

  const user = await findAccount(tenantId, email);
  // Always run one scrypt verification so response time does not reveal whether the account exists.
  const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));

  if (!user || !user.passwordHash || !valid) {
    // Both attempts stay recorded as failures.
    await audit({
      action: "auth.login_failed",
      tenantId,
      actorId: user?.id ?? null,
      data: { email, reason: "invalid_credentials" },
    });
    return { ok: false, error: "invalid_credentials" };
  }

  if (user.disabledAt) {
    await audit({ action: "auth.login_failed", tenantId, actorId: user.id, data: { email, reason: "disabled" } });
    return { ok: false, error: "disabled" };
  }

  await rateLimit.clear(accountKey);
  await rateLimit.release(ipTry); // successful sign-ins don't count against the IP

  await upgradePasswordHash(user, password, user.passwordHash);

  // Drop any session this browser already had, so a new one never inherits an old token.
  await destroySession();

  const needsTotp = user.totpEnabledAt !== null && user.totpSecretEnc !== null;
  await createSession(user.id, user.role, { pendingTotp: needsTotp });

  if (needsTotp) {
    await audit({ action: "auth.login_password_ok", tenantId: user.tenantId, actorId: user.id });
    return { ok: true, next: "totp" };
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ action: "auth.login", tenantId: user.tenantId, actorId: user.id });
  return { ok: true, next: "done" };
}

// ─── Second factor at login ─────────────────────────────────────────────────

export type VerifyTotpResult =
  | { ok: true; usedRecoveryCode: boolean }
  | { ok: false; error: "no_pending_session" | "invalid_code" | "rate_limited" };

/** Completes a pending-TOTP session with an authenticator code or a recovery code. */
export async function verifyLoginTotp(code: string): Promise<VerifyTotpResult> {
  const session = await getSession();
  if (!session || !session.pendingTotp) return { ok: false, error: "no_pending_session" };
  const { user } = session;

  const key = keys.totpSession(session.sessionId);
  // The per-user limit stops an attacker who knows the password from getting fresh guesses
  // by starting a new pending session after each per-session lock-out.
  const userKey = keys.totpUser(user.id);
  // Every guess is recorded atomically up front (cleared on success).
  const sessionTry = await rateLimit.consume(key, RULES.totpPerSession);
  const userTry = sessionTry.allowed ? await rateLimit.consume(userKey, RULES.totpPerUser) : null;
  if (!sessionTry.allowed || !userTry?.allowed) {
    await rateLimit.release(sessionTry);
    // Too many guesses: kill the pending session so the attacker must pass the password step again
    // (which is itself rate limited per account).
    await destroySession();
    await audit({ action: "auth.totp_failed", tenantId: user.tenantId, actorId: user.id, data: { reason: "rate_limited" } });
    return { ok: false, error: "rate_limited" };
  }

  const parsed = totpCodeSchema.safeParse(code);
  let ok = false;
  let usedRecoveryCode = false;
  if (parsed.success) {
    const clean = parsed.data.replace(/\s/g, "");
    if (/^\d{6}$/.test(clean)) {
      const row = await db.user.findUnique({ where: { id: user.id }, select: { totpSecretEnc: true } });
      if (row?.totpSecretEnc) ok = await acceptTotp(user.id, decrypt(row.totpSecretEnc), clean);
    } else {
      ok = usedRecoveryCode = await consumeRecoveryCode(user.id, clean);
    }
  }

  if (!ok) {
    await audit({ action: "auth.totp_failed", tenantId: user.tenantId, actorId: user.id, data: { reason: "invalid_code" } });
    return { ok: false, error: "invalid_code" };
  }

  await promoteSession(session.sessionId, user.role);
  await Promise.all([rateLimit.clear(key), rateLimit.clear(userKey)]);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ action: "auth.login", tenantId: user.tenantId, actorId: user.id, data: { method: usedRecoveryCode ? "recovery_code" : "totp" } });
  if (usedRecoveryCode) await audit({ action: "auth.recovery_code_used", tenantId: user.tenantId, actorId: user.id });
  return { ok: true, usedRecoveryCode };
}

// ─── Logout ─────────────────────────────────────────────────────────────────

export async function logout(): Promise<void> {
  const session = await getSession();
  await destroySession();
  if (session) await audit({ action: "auth.logout", tenantId: session.user.tenantId, actorId: session.user.id });
}

// ─── TOTP enrollment ────────────────────────────────────────────────────────

type AuthUser = Pick<SessionUser, "id" | "tenantId" | "email"> & { role: Role };

/** Generates a new secret for the user to scan. Nothing is stored until `confirmTotpEnrollment`. */
export function startTotpEnrollment(user: Pick<SessionUser, "email">): { secret: string; uri: string } {
  const secret = generateTotpSecret();
  return { secret, uri: totpUri(secret, user.email) };
}

export type ConfirmTotpResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; error: "already_enabled" | "invalid_secret" | "invalid_code" };

/** Stores the secret once the user proves their app produces valid codes. Returns recovery codes once. */
export async function confirmTotpEnrollment(user: AuthUser, secret: string, code: string): Promise<ConfirmTotpResult> {
  const parsedSecret = totpSecretSchema.safeParse(secret);
  if (!parsedSecret.success) return { ok: false, error: "invalid_secret" };

  const current = await db.user.findUnique({ where: { id: user.id }, select: { totpEnabledAt: true } });
  if (!current) return { ok: false, error: "invalid_code" };
  if (current.totpEnabledAt) return { ok: false, error: "already_enabled" };

  const parsedCode = totpCodeSchema.safeParse(code);
  if (!parsedCode.success || !(await acceptTotp(user.id, parsedSecret.data, parsedCode.data))) {
    return { ok: false, error: "invalid_code" };
  }

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    db.recoveryCode.createMany({
      data: recoveryCodes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })),
    }),
    db.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: encrypt(parsedSecret.data), totpEnabledAt: new Date() },
    }),
  ]);
  await audit({ action: "auth.totp_enabled", tenantId: user.tenantId, actorId: user.id });
  return { ok: true, recoveryCodes };
}

export type DisableTotpResult = { ok: true } | { ok: false; error: "invalid_password" | "rate_limited" };

export async function disableTotp(user: AuthUser, password: string): Promise<DisableTotpResult> {
  const parsed = submittedPasswordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: "invalid_password" };
  const check = await verifyCurrentPassword(user.id, parsed.data);
  if (check !== "ok") return { ok: false, error: check === "rate_limited" ? "rate_limited" : "invalid_password" };

  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    db.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpEnabledAt: null } }),
  ]);
  // The account just got weaker: end every other session (keep this device signed in).
  const current = await getSession();
  await destroyAllSessions(user.id, current?.user.id === user.id ? current.sessionId : undefined);
  await audit({ action: "auth.totp_disabled", tenantId: user.tenantId, actorId: user.id });
  return { ok: true };
}

// ─── Password reset ─────────────────────────────────────────────────────────

/**
 * Creates a one-time reset token and returns it (raw) so the caller can email a link.
 * Returns null for unknown/disabled accounts or when rate limited. Callers must show the same
 * response either way, so the result never reveals whether the account exists.
 */
export async function requestPasswordReset(tenantId: string | null, email: string): Promise<string | null> {
  const parsed = z.object({ tenantId: tenantIdSchema, email: emailSchema }).safeParse({ tenantId, email });
  if (!parsed.success) return null;
  const { tenantId: tid, email: normalized } = parsed.data;

  if (!(await rateLimit.take(keys.reset(tid, normalized), RULES.passwordResetPerEmail))) return null;

  const user = await findAccount(tid, normalized);
  if (!user || user.disabledAt) return null;

  const token = generateToken();
  const now = new Date();
  await db.$transaction([
    // Only the newest link works.
    db.authToken.updateMany({
      where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null },
      data: { usedAt: now },
    }),
    db.authToken.create({
      data: {
        userId: user.id,
        type: "PASSWORD_RESET",
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      },
    }),
  ]);
  await audit({ action: "auth.password_reset_requested", tenantId: user.tenantId, actorId: user.id });
  return token;
}

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: "invalid_token" | "invalid_password"; message?: string };

/**
 * `scope` binds the token to the host it is redeemed on: `{ tenantId: null }` = platform host
 * (SUPERADMIN accounts), a tenant id = that shop's accounts. Omit only in trusted server code.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  scope?: { tenantId: string | null },
): Promise<ResetPasswordResult> {
  const pw = newPasswordSchema.safeParse(newPassword);
  if (!pw.success) return { ok: false, error: "invalid_password", message: pw.error.issues[0]?.message };
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return { ok: false, error: "invalid_token" };

  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.type !== "PASSWORD_RESET" || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.user.disabledAt) {
    return { ok: false, error: "invalid_token" };
  }
  if (scope && row.user.tenantId !== scope.tenantId) return { ok: false, error: "invalid_token" };

  // Claim the token atomically so two concurrent submissions cannot both succeed.
  const { count } = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) return { ok: false, error: "invalid_token" };

  const passwordHash = await hashPassword(pw.data);
  // The reset link went to this mailbox, so a successful reset also proves the address.
  await db.user.update({
    where: { id: row.userId },
    data: { passwordHash, ...(row.user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) },
  });
  if (row.user.role === "CUSTOMER" && row.user.tenantId) {
    await claimVerifiedEmailAndAudit(row.user.tenantId, row.userId).catch((e) => console.error("resetPassword: claim failed", e));
  }
  await destroyAllSessions(row.userId);
  // A successful reset proves mailbox ownership; lift any lock-out on the account.
  await rateLimit.clear(keys.loginAccount(row.user.tenantId, row.user.email));
  await audit({ action: "auth.password_reset", tenantId: row.user.tenantId, actorId: row.userId });
  return { ok: true };
}

// ─── Change password ────────────────────────────────────────────────────────

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; error: "invalid_current_password" | "invalid_password" | "rate_limited"; message?: string };

/**
 * Changes the password of a signed-in user. Other sessions are signed out;
 * pass `keepSessionId` (the caller's current session) to stay signed in on this device.
 */
export async function changePassword(
  user: AuthUser,
  current: string,
  next: string,
  keepSessionId?: string,
): Promise<ChangePasswordResult> {
  const pw = newPasswordSchema.safeParse(next);
  if (!pw.success) return { ok: false, error: "invalid_password", message: pw.error.issues[0]?.message };
  const cur = submittedPasswordSchema.safeParse(current);
  if (!cur.success) return { ok: false, error: "invalid_current_password" };

  const check = await verifyCurrentPassword(user.id, cur.data);
  if (check === "rate_limited") return { ok: false, error: "rate_limited" };
  if (check === "invalid") return { ok: false, error: "invalid_current_password" };

  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw.data) } });
  await destroyAllSessions(user.id, keepSessionId);
  await audit({ action: "auth.password_changed", tenantId: user.tenantId, actorId: user.id });
  return { ok: true };
}
