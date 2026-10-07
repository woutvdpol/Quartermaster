import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setJobTransportForTests } from "@/server/jobs/queue";
import { login, verifyCurrentPassword } from "@/server/auth/service";
import { destroySession, getSession } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { changeCustomerEmail, customerLogin } from "@/server/customer-auth";
import { updateOwnProfile } from "@/server/users";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";

/*
 * Concept500 users migrated by the ETL keep their Laravel bcrypt hash as `bcrypt$<hash>` until their
 * first successful password check; from then on they have a scrypt hash. Every login path is covered.
 *
 * Hash: PHP 8.4.16 crypt("hunter2-legacy", '$2y$04$abcdefghijklmnopqrstuu') — see legacy-bcrypt.test.ts.
 * The Laravel default cost-10 hash is exercised once below (Laravel UserFactory hash of "password").
 */
const PASSWORD = "hunter2-legacy";
const LEGACY = "bcrypt$$2y$04$abcdefghijklmnopqrstuuYQzyYpuBlD9anKNO5exwCD0BATGyB9S";
const LARAVEL_DEFAULT = "bcrypt$$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi";

async function hashOf(id: string) {
  return (await db.user.findUniqueOrThrow({ where: { id }, select: { passwordHash: true } })).passwordHash!;
}

beforeEach(async () => {
  await resetDb();
  await destroySession();
  setJobTransportForTests(() => {});
});
afterEach(() => setJobTransportForTests(null));

describe("legacy bcrypt → scrypt", () => {
  it("staff (/admin) login: wrong password keeps bcrypt, right password signs in and rehashes", async () => {
    const ctx = await createTenantContext();
    await db.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: LEGACY } });

    expect(await login({ email: ctx.actor.email, password: "wrong", tenantId: ctx.tenantId, ip: null })).toEqual({ ok: false, error: "invalid_credentials" });
    expect(await hashOf(ctx.actor.id)).toBe(LEGACY);

    expect(await login({ email: ctx.actor.email, password: PASSWORD, tenantId: ctx.tenantId, ip: null })).toEqual({ ok: true, next: "done" });
    expect((await getSession())?.user.id).toBe(ctx.actor.id);
    const upgraded = await hashOf(ctx.actor.id);
    expect(upgraded).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword(PASSWORD, upgraded)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "auth.password_rehashed", actorId: ctx.actor.id } })).toBe(1);

    // And the next login uses the scrypt hash.
    await destroySession();
    expect(await login({ email: ctx.actor.email, password: PASSWORD, tenantId: ctx.tenantId, ip: null })).toEqual({ ok: true, next: "done" });
    expect(await hashOf(ctx.actor.id)).toBe(upgraded);
  });

  it("shop customer login rehashes (Laravel default cost 10)", async () => {
    const ctx = await createTenantContext();
    const user = await db.user.create({
      data: { tenantId: ctx.tenantId, role: "CUSTOMER", email: "legacy@example.test", passwordHash: LARAVEL_DEFAULT },
    });
    expect(await customerLogin({ tenantId: ctx.tenantId, email: "Legacy@Example.test", password: "password", ip: "203.0.113.9" })).toEqual({ ok: true, next: "done" });
    expect(await hashOf(user.id)).toMatch(/^scrypt\$/);
    expect(await verifyPassword("password", await hashOf(user.id))).toBe(true);
    // The customer row was linked on first login as well.
    expect(await db.customer.count({ where: { tenantId: ctx.tenantId, userId: user.id } })).toBe(1);
  });

  it("re-authentication (customer email change) rehashes", async () => {
    const ctx = await createTenantContext();
    const user = await db.user.create({
      data: { tenantId: ctx.tenantId, role: "CUSTOMER", email: "c@example.test", passwordHash: LEGACY },
    });
    const cu = { id: user.id, tenantId: ctx.tenantId, email: user.email, role: user.role };
    expect(await changeCustomerEmail(cu, "c2@example.test", "nope")).toEqual({ ok: false, error: "invalid_password" });
    expect(await hashOf(user.id)).toBe(LEGACY);
    expect(await changeCustomerEmail(cu, "c2@example.test", PASSWORD)).toMatchObject({ ok: true });
    expect(await hashOf(user.id)).toMatch(/^scrypt\$/);
  });

  it("re-authentication (staff profile email change, verifyCurrentPassword) rehashes", async () => {
    const ctx = await createTenantContext();
    await db.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: LEGACY } });
    expect(await updateOwnProfile(ctx.actor, { email: "new-owner@example.test", currentPassword: PASSWORD })).toMatchObject({ ok: true });
    expect(await hashOf(ctx.actor.id)).toMatch(/^scrypt\$/);

    await db.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: LEGACY } });
    expect(await verifyCurrentPassword(ctx.actor.id, PASSWORD)).toBe("ok");
    expect(await hashOf(ctx.actor.id)).toMatch(/^scrypt\$/);
  });

  it("a malformed legacy hash never signs in", async () => {
    const ctx = await createTenantContext();
    await db.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: "bcrypt$$2y$31$abcdefghijklmnopqrstuuYQzyYpuBlD9anKNO5exwCD0BATGyB9S" } });
    expect(await login({ email: ctx.actor.email, password: PASSWORD, tenantId: ctx.tenantId, ip: null })).toEqual({ ok: false, error: "invalid_credentials" });
  });
});
