import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { AuthError, canAccessTenant } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { MAX_PASSWORD_LENGTH } from "@/server/auth/password";
import { verifyCurrentPassword } from "@/server/auth/service";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { isUniqueViolation, parseInput } from "@/server/catalog/errors";
import type { Prisma } from "@/generated/prisma/client";

/*
 * Staff management (OWNER accounts of a tenant) and the signed-in user's own profile/sessions.
 *
 * Rules
 * - Staff = OWNER users of `ctx.tenantId`. CUSTOMER accounts are never managed here (→ NOT_FOUND).
 * - SUPERADMIN accounts have no tenant. Only a SUPERADMIN may disable/enable them; an OWNER gets FORBIDDEN.
 * - Nobody can disable themselves (prevents locking the last admin out by accident).
 * - Disabling destroys all sessions and voids unused invite/reset tokens.
 * - Invites reuse AuthToken type PASSWORD_RESET (no schema change): an invited OWNER has no password
 *   until they open the link and choose one via `resetPassword()` in auth/service. TTL is longer
 *   than a normal reset (7 days). A later `requestPasswordReset` voids the invite (only the newest link works).
 * - Role failures (actor may not do this at all) throw AuthError("FORBIDDEN"); rule violations on a
 *   specific target throw ServiceError.
 */

type Tx = Prisma.TransactionClient;
export type ActingUser = Pick<SessionUser, "id" | "role" | "tenantId" | "email">;

export const OWNER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const idSchema = z.string().trim().min(1).max(64);
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const nameSchema = z.string().trim().min(1).max(120);

// ─── Invite mail hook ───────────────────────────────────────────────────────

export type OwnerInviteNotice = {
  tenantId: string;
  userId: string;
  email: string;
  name: string | null;
  /** Raw one-time token for the set-password (reset) page on the tenant's primary host; redeem with auth `resetPassword()`. */
  token: string;
  expiresAt: Date;
  invitedBy: { id: string; email: string };
};
type InviteNotifier = (notice: OwnerInviteNotice) => Promise<void>;
let inviteNotifier: InviteNotifier | null = null;

/**
 * TODO(mail): the mail module registers the owner-invite e-mail sender here (e.g. at startup /
 * in instrumentation). Until then invites still succeed and the raw token is returned to the
 * caller (UI can show a copyable link). Notifier failures are logged, never thrown.
 */
export function setOwnerInviteNotifier(fn: InviteNotifier | null) {
  inviteNotifier = fn;
}

async function notifyInvite(notice: OwnerInviteNotice) {
  if (!inviteNotifier) return;
  try {
    await inviteNotifier(notice);
  } catch (err) {
    console.error(`[users] invite notifier failed for user ${notice.userId}:`, err);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function assertTenantStaff(ctx: ServiceContext) {
  if (!canAccessTenant(ctx.actor, ctx.tenantId)) throw new AuthError("FORBIDDEN");
}

function assertStaffActor(user: ActingUser) {
  if (user.role !== "SUPERADMIN" && user.role !== "OWNER") throw new AuthError("FORBIDDEN");
}

const staffSelect = {
  id: true,
  tenantId: true,
  role: true,
  email: true,
  name: true,
  passwordHash: true,
  totpEnabledAt: true,
  disabledAt: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type StaffRow = Prisma.UserGetPayload<{ select: typeof staffSelect }>;

export type StaffMember = {
  id: string;
  role: "OWNER" | "SUPERADMIN";
  email: string;
  name: string | null;
  /** Invited but no password chosen yet. */
  invitePending: boolean;
  totpEnabled: boolean;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

function toStaff(u: StaffRow): StaffMember {
  return {
    id: u.id,
    role: u.role as StaffMember["role"],
    email: u.email,
    name: u.name,
    invitePending: u.passwordHash === null,
    totpEnabled: u.totpEnabledAt !== null,
    disabledAt: u.disabledAt,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

/**
 * Loads a user the actor may manage in this tenant context:
 * OWNER of ctx.tenantId, or any SUPERADMIN (only when the actor is SUPERADMIN; OWNER → FORBIDDEN).
 * Everything else (other tenants, customers, unknown ids) → NOT_FOUND.
 */
async function loadManageableUser(ctx: ServiceContext, userId: string): Promise<StaffRow> {
  const target = await db.user.findUnique({ where: { id: userId }, select: staffSelect });
  if (target?.role === "SUPERADMIN") {
    if (ctx.actor.role !== "SUPERADMIN") throw new ServiceError("FORBIDDEN", "Shop owners cannot manage platform administrators");
    return target;
  }
  if (!target || target.role !== "OWNER" || target.tenantId !== ctx.tenantId) {
    throw new ServiceError("NOT_FOUND", "User not found");
  }
  return target;
}

// ─── Staff ──────────────────────────────────────────────────────────────────

/** OWNER accounts of the tenant (OWNER and SUPERADMIN actors alike). */
export async function listStaff(ctx: ServiceContext): Promise<StaffMember[]> {
  assertTenantStaff(ctx);
  const rows = await db.user.findMany({
    where: { tenantId: ctx.tenantId, role: "OWNER" },
    select: staffSelect,
    orderBy: [{ disabledAt: { sort: "asc", nulls: "first" } }, { email: "asc" }],
  });
  return rows.map(toStaff);
}

/** Creates a fresh invite token for `userId`, voiding older unused ones. Runs inside `tx`. */
async function issueInviteToken(tx: Tx, userId: string) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OWNER_INVITE_TTL_MS);
  await tx.authToken.updateMany({ where: { userId, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: now } });
  await tx.authToken.create({ data: { userId, type: "PASSWORD_RESET", tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

/**
 * Creates an OWNER without password + invite token inside an existing transaction.
 * Used by `inviteOwner` and platform `createTenant`. Caller audits and calls `notifyOwnerInvite` after commit.
 */
export async function createOwnerInvite(tx: Tx, input: { tenantId: string; email: string; name?: string | null }) {
  const email = parseInput(emailSchema, input.email);
  const name = input.name == null || input.name === "" ? null : parseInput(nameSchema, input.name);
  try {
    const user = await tx.user.create({
      data: { tenantId: input.tenantId, role: "OWNER", email, name },
      select: staffSelect,
    });
    const { token, expiresAt } = await issueInviteToken(tx, user.id);
    return { user: toStaff(user), token, expiresAt };
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "An account with this e-mail already exists in this shop");
    throw err;
  }
}

/** @internal Fires the invite mail hook (best effort). */
export async function notifyOwnerInvite(notice: OwnerInviteNotice) {
  await notifyInvite(notice);
}

const inviteSchema = z.object({ email: emailSchema, name: nameSchema.optional().nullable() });

/**
 * Invites a new shop owner. Returns the raw token ONCE (for the invite link) — never log or store it.
 * CONFLICT when the e-mail already has any account (owner or customer) in this tenant.
 */
export async function inviteOwner(ctx: ServiceContext, input: z.input<typeof inviteSchema>) {
  assertTenantStaff(ctx);
  const data = parseInput(inviteSchema, input);
  const result = await db.$transaction((tx) => createOwnerInvite(tx, { tenantId: ctx.tenantId, ...data }));
  await audit({
    action: "user.invited",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "User",
    entityId: result.user.id,
    data: { email: result.user.email },
  });
  await notifyInvite({
    tenantId: ctx.tenantId,
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    token: result.token,
    expiresAt: result.expiresAt,
    invitedBy: { id: ctx.actor.id, email: ctx.actor.email },
  });
  return result;
}

/** Re-sends an invite (new token, old one voided). Only for owners that have not set a password yet. */
export async function resendOwnerInvite(ctx: ServiceContext, userId: string) {
  assertTenantStaff(ctx);
  const target = await loadManageableUser(ctx, parseInput(idSchema, userId));
  if (target.role !== "OWNER" || target.passwordHash !== null) throw new ServiceError("INVALID", "This user has already accepted the invite");
  if (target.disabledAt) throw new ServiceError("INVALID", "This user is disabled");
  const { token, expiresAt } = await db.$transaction((tx) => issueInviteToken(tx, target.id));
  await audit({ action: "user.invite_resent", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "User", entityId: target.id });
  await notifyInvite({
    tenantId: ctx.tenantId,
    userId: target.id,
    email: target.email,
    name: target.name,
    token,
    expiresAt,
    invitedBy: { id: ctx.actor.id, email: ctx.actor.email },
  });
  return { token, expiresAt };
}

/** Disables an account: blocks login, destroys sessions, voids unused tokens. Idempotent. */
export async function disableUser(ctx: ServiceContext, userId: string): Promise<StaffMember> {
  assertTenantStaff(ctx);
  const id = parseInput(idSchema, userId);
  if (id === ctx.actor.id) throw new ServiceError("FORBIDDEN", "You cannot disable your own account");
  const target = await loadManageableUser(ctx, id);
  if (target.disabledAt) return toStaff(target);

  const now = new Date();
  const [updated] = await db.$transaction([
    db.user.update({ where: { id }, data: { disabledAt: now }, select: staffSelect }),
    db.session.deleteMany({ where: { userId: id } }),
    db.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: now } }),
  ]);
  await audit({
    action: "user.disabled",
    tenantId: target.tenantId, // null for SUPERADMIN targets → platform log
    actorId: ctx.actor.id,
    entity: "User",
    entityId: id,
    data: { email: target.email },
  });
  return toStaff(updated);
}

export async function enableUser(ctx: ServiceContext, userId: string): Promise<StaffMember> {
  assertTenantStaff(ctx);
  const id = parseInput(idSchema, userId);
  const target = await loadManageableUser(ctx, id);
  if (!target.disabledAt) return toStaff(target);
  const updated = await db.user.update({ where: { id }, data: { disabledAt: null }, select: staffSelect });
  await audit({
    action: "user.enabled",
    tenantId: target.tenantId, // null for SUPERADMIN targets → platform log
    actorId: ctx.actor.id,
    entity: "User",
    entityId: id,
    data: { email: target.email },
  });
  return toStaff(updated);
}

/**
 * SUPERADMIN only: removes a user's TOTP secret and recovery codes (lost authenticator) and signs
 * them out everywhere. Not for your own account — use `disableTotp` (requires your password).
 */
export async function resetUserTwoFactor(ctx: ServiceContext, userId: string): Promise<StaffMember> {
  assertTenantStaff(ctx);
  if (ctx.actor.role !== "SUPERADMIN") throw new AuthError("FORBIDDEN");
  const id = parseInput(idSchema, userId);
  if (id === ctx.actor.id) throw new ServiceError("FORBIDDEN", "Use your own security settings to change your 2FA");
  const target = await loadManageableUser(ctx, id);
  const [updated] = await db.$transaction([
    db.user.update({ where: { id }, data: { totpSecretEnc: null, totpEnabledAt: null }, select: staffSelect }),
    db.recoveryCode.deleteMany({ where: { userId: id } }),
    db.session.deleteMany({ where: { userId: id } }),
  ]);
  await audit({
    action: "user.2fa_reset",
    tenantId: target.tenantId, // null for SUPERADMIN targets → platform log
    actorId: ctx.actor.id,
    entity: "User",
    entityId: id,
    data: { email: target.email, hadTotp: target.totpEnabledAt !== null },
  });
  return toStaff(updated);
}

// ─── Own sessions ───────────────────────────────────────────────────────────

export type SessionInfo = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

/** The user's active (non-expired, fully signed-in) sessions, newest activity first. */
export async function listSessions(user: ActingUser, currentSessionId?: string | null): Promise<SessionInfo[]> {
  const rows = await db.session.findMany({
    where: { userId: user.id, pendingTotp: false, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, ip: true, userAgent: true },
  });
  return rows.map((s) => ({ ...s, current: s.id === currentSessionId }));
}

/** Signs out one of the user's own sessions. NOT_FOUND for sessions of other users. */
export async function revokeSession(user: ActingUser, sessionId: string): Promise<void> {
  const id = parseInput(idSchema, sessionId);
  const { count } = await db.session.deleteMany({ where: { id, userId: user.id } });
  if (count === 0) throw new ServiceError("NOT_FOUND", "Session not found");
  await audit({ action: "auth.session_revoked", tenantId: user.tenantId, actorId: user.id, entity: "Session", entityId: id });
}

/** Signs out everywhere except the current session. Returns the number of revoked sessions. */
export async function revokeOtherSessions(user: ActingUser, currentSessionId: string): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { userId: user.id, id: { not: currentSessionId } } });
  if (count) await audit({ action: "auth.sessions_revoked", tenantId: user.tenantId, actorId: user.id, data: { count } });
  return count;
}

// ─── Own profile ────────────────────────────────────────────────────────────

const profileSchema = z.object({
  name: z.union([nameSchema, z.literal("").transform(() => null), z.null()]).optional(),
  email: emailSchema.optional(),
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH).optional(),
});

export type UpdateProfileResult =
  | { ok: true; profile: { id: string; email: string; name: string | null } }
  | { ok: false; error: "invalid_password" | "rate_limited" | "email_taken" };

/**
 * Updates the signed-in staff member's own name/e-mail. Changing the e-mail requires the current
 * password (rate limited on the same key as other re-auth prompts) and clears `emailVerifiedAt`.
 */
export async function updateOwnProfile(
  user: ActingUser,
  input: z.input<typeof profileSchema>,
): Promise<UpdateProfileResult> {
  assertStaffActor(user); // customer e-mails are mirrored on Customer rows; managed by the customers module
  const data = parseInput(profileSchema, input);
  const current = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, tenantId: true, passwordHash: true },
  });
  if (!current) throw new ServiceError("NOT_FOUND", "User not found");

  const emailChanged = data.email !== undefined && data.email !== current.email;
  const nameChanged = data.name !== undefined && data.name !== current.name;
  if (!emailChanged && !nameChanged) return { ok: true, profile: { id: current.id, email: current.email, name: current.name } };

  if (emailChanged) {
    // Shared re-auth: backoff per user + rehash of legacy (bcrypt) hashes.
    const check = await verifyCurrentPassword(user.id, data.currentPassword ?? "");
    if (check !== "ok") return { ok: false, error: check === "rate_limited" ? "rate_limited" : "invalid_password" };
    const taken = await db.user.findFirst({
      where: { tenantId: current.tenantId, email: data.email, id: { not: current.id } },
      select: { id: true },
    });
    if (taken) return { ok: false, error: "email_taken" };
  }

  let updated;
  try {
    updated = await db.user.update({
      where: { id: user.id },
      data: {
        ...(nameChanged ? { name: data.name ?? null } : {}),
        ...(emailChanged ? { email: data.email, emailVerifiedAt: null } : {}),
      },
      select: { id: true, email: true, name: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "email_taken" };
    throw err;
  }

  if (emailChanged) {
    await audit({
      action: "user.email_changed",
      tenantId: current.tenantId,
      actorId: user.id,
      entity: "User",
      entityId: user.id,
      data: { from: current.email, to: updated.email },
    });
  }
  if (nameChanged) {
    await audit({ action: "user.profile_updated", tenantId: current.tenantId, actorId: user.id, entity: "User", entityId: user.id, data: { fields: ["name"] } });
  }
  return { ok: true, profile: updated };
}
