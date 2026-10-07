import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import { AuthError } from "@/server/auth/guards";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { resetPassword } from "@/server/auth/service";
import {
  disableUser,
  enableUser,
  inviteOwner,
  listSessions,
  listStaff,
  resendOwnerInvite,
  resetUserTwoFactor,
  revokeSession,
  setOwnerInviteNotifier,
  updateOwnProfile,
  type OwnerInviteNotice,
} from "@/server/users";
import { createTenantContext, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => setOwnerInviteNotifier(null));

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await expect(promise).rejects.toMatchObject({ code });
}

async function addOwner(ctx: ServiceContext, email: string) {
  return db.user.create({ data: { tenantId: ctx.tenantId, role: "OWNER", email, passwordHash: await hashPassword("correct horse battery") } });
}

async function addSession(userId: string) {
  return db.session.create({ data: { userId, tokenHash: `h-${userId}-${Math.random()}`, expiresAt: new Date(Date.now() + 3_600_000) } });
}

/** A SUPERADMIN acting in `tenantId` (as built by requireStaffContext). */
async function superadminIn(tenantId: string): Promise<ServiceContext> {
  const u = await db.user.create({ data: { role: "SUPERADMIN", tenantId: null, email: `root-${Math.random()}@qm.test` } });
  return { tenantId, actor: { id: u.id, role: u.role, tenantId: null, email: u.email } };
}

describe("staff rules", () => {
  it("owner cannot disable a superadmin or themselves", async () => {
    const owner = await createTenantContext();
    const admin = await superadminIn(owner.tenantId);
    await expectServiceError(disableUser(owner, admin.actor.id), "FORBIDDEN");
    await expectServiceError(disableUser(owner, owner.actor.id), "FORBIDDEN");
    await expectServiceError(enableUser(owner, admin.actor.id), "FORBIDDEN");
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.actor.id } })).disabledAt).toBeNull();
  });

  it("owner disables a co-owner: sessions and pending tokens are gone; enable restores login", async () => {
    const owner = await createTenantContext();
    const co = await addOwner(owner, "co@shop.test");
    await addSession(co.id);
    await db.authToken.create({ data: { userId: co.id, type: "PASSWORD_RESET", tokenHash: "tok-co", expiresAt: new Date(Date.now() + 60_000) } });

    const disabled = await disableUser(owner, co.id);
    expect(disabled.disabledAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: co.id } })).toBe(0);
    expect((await db.authToken.findUniqueOrThrow({ where: { tokenHash: "tok-co" } })).usedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "user.disabled", entityId: co.id, tenantId: owner.tenantId } })).toBe(1);

    const enabled = await enableUser(owner, co.id);
    expect(enabled.disabledAt).toBeNull();
  });

  it("superadmin can disable another superadmin (audited at platform level) but not themselves", async () => {
    const owner = await createTenantContext();
    const admin = await superadminIn(owner.tenantId);
    const other = await superadminIn(owner.tenantId);
    await expectServiceError(disableUser(admin, admin.actor.id), "FORBIDDEN");
    await disableUser(admin, other.actor.id);
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "user.disabled", entityId: other.actor.id } });
    expect(row.tenantId).toBeNull();
  });

  it("isolates tenants: other tenants' owners and customers are not found", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const bOwner = await addOwner(b, "b2@shop.test");
    const aCustomer = await db.user.create({ data: { tenantId: a.tenantId, role: "CUSTOMER", email: "c@x.test" } });

    await expectServiceError(disableUser(a, bOwner.id), "NOT_FOUND");
    await expectServiceError(disableUser(a, aCustomer.id), "NOT_FOUND");
    await expectServiceError(disableUser(a, "nope"), "NOT_FOUND");

    const staff = await listStaff(a);
    expect(staff.map((s) => s.id)).toEqual([a.actor.id]);
    // A forged context for a tenant the owner does not belong to is rejected.
    await expect(listStaff({ ...a, tenantId: b.tenantId })).rejects.toBeInstanceOf(AuthError);
  });

  it("superadmin lists a tenant's owners", async () => {
    const owner = await createTenantContext();
    await addOwner(owner, "zz@shop.test");
    const admin = await superadminIn(owner.tenantId);
    const staff = await listStaff(admin);
    expect(staff).toHaveLength(2);
    expect(staff.every((s) => s.role === "OWNER")).toBe(true);
  });

  it("resetUserTwoFactor is superadmin-only and clears TOTP + recovery codes + sessions", async () => {
    const owner = await createTenantContext();
    const co = await addOwner(owner, "co@shop.test");
    await db.user.update({ where: { id: co.id }, data: { totpSecretEnc: "v1.x.y.z", totpEnabledAt: new Date() } });
    await db.recoveryCode.create({ data: { userId: co.id, codeHash: "h" } });
    await addSession(co.id);

    await expect(resetUserTwoFactor(owner, co.id)).rejects.toBeInstanceOf(AuthError);

    const admin = await superadminIn(owner.tenantId);
    const result = await resetUserTwoFactor(admin, co.id);
    expect(result.totpEnabled).toBe(false);
    const row = await db.user.findUniqueOrThrow({ where: { id: co.id } });
    expect([row.totpSecretEnc, row.totpEnabledAt]).toEqual([null, null]);
    expect(await db.recoveryCode.count({ where: { userId: co.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: co.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "user.2fa_reset", entityId: co.id } })).toBe(1);
  });
});

describe("owner invites", () => {
  it("creates a password-less owner whose invite token sets the password", async () => {
    const owner = await createTenantContext();
    const notices: OwnerInviteNotice[] = [];
    setOwnerInviteNotifier(async (n) => void notices.push(n));

    const { user, token } = await inviteOwner(owner, { email: " New@Shop.test ", name: "New Owner" });
    expect(user).toMatchObject({ email: "new@shop.test", role: "OWNER", invitePending: true });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: user.id, token, tenantId: owner.tenantId });

    expect(await resetPassword(token, "a brand new password")).toEqual({ ok: true });
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("a brand new password", row.passwordHash!)).toBe(true);
    // Accepted invites cannot be re-sent.
    await expectServiceError(resendOwnerInvite(owner, user.id), "INVALID");
  });

  it("rejects duplicates and survives a failing notifier", async () => {
    const owner = await createTenantContext();
    setOwnerInviteNotifier(async () => {
      throw new Error("smtp down");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await inviteOwner(owner, { email: "dup@shop.test" });
    expect(first.token).toBeTruthy();
    expect(spy).toHaveBeenCalled();
    await expectServiceError(inviteOwner(owner, { email: "DUP@shop.test" }), "CONFLICT");
    await expectServiceError(inviteOwner(owner, { email: "not-an-email" }), "INVALID");
    spy.mockRestore();
  });

  it("re-sending voids the previous invite link", async () => {
    const owner = await createTenantContext();
    const { user, token: oldToken } = await inviteOwner(owner, { email: "late@shop.test" });
    const { token: newToken } = await resendOwnerInvite(owner, user.id);
    expect(await resetPassword(oldToken, "another long password")).toMatchObject({ ok: false, error: "invalid_token" });
    expect(await resetPassword(newToken, "another long password")).toEqual({ ok: true });
  });
});

describe("own sessions and profile", () => {
  it("lists and revokes only the user's own sessions", async () => {
    const owner = await createTenantContext();
    const other = await addOwner(owner, "o@shop.test");
    const mine = await addSession(owner.actor.id);
    const theirs = await addSession(other.id);
    await db.session.create({ data: { userId: owner.actor.id, tokenHash: "expired", expiresAt: new Date(Date.now() - 1000) } });

    const list = await listSessions(owner.actor, mine.id);
    expect(list.map((s) => [s.id, s.current])).toEqual([[mine.id, true]]);

    await expectServiceError(revokeSession(owner.actor, theirs.id), "NOT_FOUND");
    await revokeSession(owner.actor, mine.id);
    expect(await db.session.count({ where: { id: mine.id } })).toBe(0);
    expect(await db.session.count({ where: { id: theirs.id } })).toBe(1);
  });

  it("changes name freely, e-mail only with the current password", async () => {
    const owner = await createTenantContext();
    await db.user.update({ where: { id: owner.actor.id }, data: { passwordHash: await hashPassword("correct horse battery"), emailVerifiedAt: new Date() } });
    await addOwner(owner, "taken@shop.test");

    expect(await updateOwnProfile(owner.actor, { name: "Jan" })).toMatchObject({ ok: true, profile: { name: "Jan" } });
    expect(await updateOwnProfile(owner.actor, { email: "new@shop.test" })).toEqual({ ok: false, error: "invalid_password" });
    expect(await updateOwnProfile(owner.actor, { email: "new@shop.test", currentPassword: "wrong" })).toEqual({ ok: false, error: "invalid_password" });
    expect(await updateOwnProfile(owner.actor, { email: "taken@shop.test", currentPassword: "correct horse battery" })).toEqual({ ok: false, error: "email_taken" });

    const ok = await updateOwnProfile(owner.actor, { email: "New@Shop.test", currentPassword: "correct horse battery" });
    expect(ok).toMatchObject({ ok: true, profile: { email: "new@shop.test" } });
    const row = await db.user.findUniqueOrThrow({ where: { id: owner.actor.id } });
    expect(row.emailVerifiedAt).toBeNull();
    expect(await db.auditLog.count({ where: { action: "user.email_changed", actorId: owner.actor.id } })).toBe(1);
  });

  it("customers cannot use the staff profile service", async () => {
    const owner = await createTenantContext();
    const c = await db.user.create({ data: { tenantId: owner.tenantId, role: "CUSTOMER", email: "c@x.test" } });
    await expect(updateOwnProfile({ id: c.id, role: c.role, tenantId: c.tenantId, email: c.email }, { name: "x" })).rejects.toBeInstanceOf(AuthError);
  });
});
