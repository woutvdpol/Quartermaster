import "server-only";
import { headers } from "next/headers";
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
import * as rateLimit from "./rate-limit";
import { RULES } from "./rate-limit";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  getSession,
  promoteSession,
  type SessionUser,
} from "./session";
import { generateRecoveryCode, generateToken, hashToken, normalizeRecoveryCode } from "./tokens";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";

/*
 * Auth use-cases. All business rules for signing in, 2FA and passwords live here;
 * route handlers / server actions only parse form data, call these, and render the result.
 *
 * Design notes
 * - Login never reveals whether an account exists: unknown users still pay for a scrypt
 *   verification (dummy hash) and get the same "invalid_credentials" error. "disabled" is only
 *   returned after the correct password was given.
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

/** Best-effort client IP from the request; null outside a request scope. */
async function requestIp(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

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
  totpUsed: (userId: string, step: number) => `totp:used:${userId}:${step}`,
  reauth: (userId: string) => `reauth:user:${userId}`,
  reset: (tenantId: string | null, email: string) => `reset:email:${tenantId ?? "platform"}:${email}`,
};

/** Verifies a TOTP code and rejects reuse of a step that was already accepted for this user. */
async function acceptTotp(userId: string, secretBase32: string, code: string): Promise<boolean> {
  const step = verifyTotp(secretBase32, code);
  if (step === null) return false;
  const key = keys.totpUsed(userId, step);
  if (await rateLimit.isLimited(key, TOTP_REPLAY_RULE)) return false;
  await rateLimit.hit(key);
  return true;
}

/** Consumes an unused recovery code. The conditional update makes concurrent use of one code fail. */
async function consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
  const codeHash = hashToken(normalizeRecoveryCode(input));
  const row = await db.recoveryCode.findFirst({ where: { userId, codeHash, usedAt: null } });
  if (!row) return false;
  const { count } = await db.recoveryCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

/** Re-authentication with the current password for sensitive changes. Rate limited per user. */
async function verifyCurrentPassword(userId: string, password: string): Promise<"ok" | "invalid" | "rate_limited"> {
  const key = keys.reauth(userId);
  if (await rateLimit.isLimited(key, RULES.loginPerAccount)) return "rate_limited";
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!ok || !user?.passwordHash) {
    await rateLimit.hit(key);
    return "invalid";
  }
  await rateLimit.clear(key);
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
  const ip = parsed.data.ip !== undefined ? parsed.data.ip : await requestIp();

  const ipKey = ip ? keys.loginIp(ip) : null;
  const accountKey = keys.loginAccount(tenantId, email);
  const [ipLimited, accountLimited] = await Promise.all([
    ipKey ? rateLimit.isLimited(ipKey, RULES.loginPerIp) : false,
    rateLimit.isLimited(accountKey, RULES.loginPerAccount),
  ]);
  if (ipLimited || accountLimited) {
    await audit({ action: "auth.login_failed", tenantId, data: { email, reason: "rate_limited" } });
    return { ok: false, error: "rate_limited" };
  }

  const user = await findAccount(tenantId, email);
  // Always run one scrypt verification so response time does not reveal whether the account exists.
  const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));

  if (!user || !user.passwordHash || !valid) {
    await Promise.all([ipKey && rateLimit.hit(ipKey), rateLimit.hit(accountKey)]);
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

  if (needsRehash(user.passwordHash)) {
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }

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
  if (await rateLimit.isLimited(key, RULES.totpPerSession)) {
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
    await rateLimit.hit(key);
    await audit({ action: "auth.totp_failed", tenantId: user.tenantId, actorId: user.id, data: { reason: "invalid_code" } });
    return { ok: false, error: "invalid_code" };
  }

  await promoteSession(session.sessionId, user.role);
  await rateLimit.clear(key);
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
      data: recoveryCodes.map((c) => ({ userId: user.id, codeHash: hashToken(normalizeRecoveryCode(c)) })),
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

  const key = keys.reset(tid, normalized);
  if (await rateLimit.isLimited(key, RULES.passwordResetPerEmail)) return null;
  await rateLimit.hit(key);

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

export async function resetPassword(token: string, newPassword: string): Promise<ResetPasswordResult> {
  const pw = newPasswordSchema.safeParse(newPassword);
  if (!pw.success) return { ok: false, error: "invalid_password", message: pw.error.issues[0]?.message };
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return { ok: false, error: "invalid_token" };

  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.type !== "PASSWORD_RESET" || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.user.disabledAt) {
    return { ok: false, error: "invalid_token" };
  }

  // Claim the token atomically so two concurrent submissions cannot both succeed.
  const { count } = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) return { ok: false, error: "invalid_token" };

  const passwordHash = await hashPassword(pw.data);
  await db.user.update({ where: { id: row.userId }, data: { passwordHash } });
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
