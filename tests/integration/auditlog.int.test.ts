import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AuthError } from "@/server/auth/guards";
import { ServiceError } from "@/server/context";
import { queryAuditLog, queryPlatformAuditLog } from "@/server/auditlog";
import { createTenantContext, resetDb } from "./helpers";

beforeEach(resetDb);

async function seed() {
  const a = await createTenantContext();
  const b = await createTenantContext();
  const admin = await db.user.create({ data: { role: "SUPERADMIN", tenantId: null, email: "root@qm.test", name: "Root" } });
  await db.auditLog.createMany({
    data: [
      { tenantId: a.tenantId, actorId: a.actor.id, action: "auth.login", ip: "10.0.0.1" },
      { tenantId: a.tenantId, actorId: a.actor.id, action: "product.create", entity: "Product", entityId: "p1", data: { stockCode: 50001, title: "Helmet" } },
      { tenantId: a.tenantId, actorId: admin.id, action: "settings.update", entity: "Setting", entityId: "catalog", data: { group: "catalog", changed: ["layout"] }, ip: "10.9.9.9" },
      { tenantId: b.tenantId, actorId: b.actor.id, action: "auth.login" },
      { tenantId: null, actorId: admin.id, action: "auth.login" },
      { tenantId: null, action: "auth.login_failed", data: { email: "x@y.z", reason: "invalid_credentials" } },
    ],
  });
  return { a, b, admin };
}

describe("queryAuditLog", () => {
  it("is tenant-scoped, newest first, with actor and summaries", async () => {
    const { a, b } = await seed();
    const page = await queryAuditLog(a);
    expect(page.items.map((i) => i.action)).toEqual(["settings.update", "product.create", "auth.login"]);
    expect(page.items.every((i) => i.tenantId === a.tenantId)).toBe(true);
    expect(page.items[1].summary).toBe(`${a.actor.email} created product 50001 "Helmet"`);
    expect(page.items[2].actor).toMatchObject({ id: a.actor.id, email: a.actor.email });
    expect(page.nextCursor).toBeNull();

    const bPage = await queryAuditLog(b);
    expect(bPage.items).toHaveLength(1);
  });

  it("masks platform staff for owners but not for superadmins", async () => {
    const { a, admin } = await seed();
    const [ownerView] = (await queryAuditLog(a, { action: "settings." })).items;
    expect(ownerView.actor).toMatchObject({ email: null, label: "Quartermaster staff" });
    expect(ownerView.ip).toBeNull();
    expect(ownerView.summary).toBe("Quartermaster staff changed catalog settings: layout");

    const adminCtx = { tenantId: a.tenantId, actor: { id: admin.id, role: admin.role, tenantId: null, email: admin.email } };
    const [adminView] = (await queryAuditLog(adminCtx, { action: "settings." })).items;
    expect(adminView.actor).toMatchObject({ email: "root@qm.test" });
    expect(adminView.ip).toBe("10.9.9.9");
  });

  it("filters and paginates", async () => {
    const { a } = await seed();
    expect((await queryAuditLog(a, { action: "auth." })).items.map((i) => i.action)).toEqual(["auth.login"]);
    expect((await queryAuditLog(a, { entity: "Product", entityId: "p1" })).items).toHaveLength(1);
    expect((await queryAuditLog(a, { actorId: a.actor.id })).items).toHaveLength(2);
    expect((await queryAuditLog(a, { from: new Date(Date.now() + 60_000) })).items).toHaveLength(0);

    const p1 = await queryAuditLog(a, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await queryAuditLog(a, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.action)).toEqual(["auth.login"]);
    expect(p2.nextCursor).toBeNull();

    await expect(queryAuditLog(a, { cursor: "1 OR 1=1" })).rejects.toBeInstanceOf(ServiceError);
  });

  it("rejects a context for a foreign tenant", async () => {
    const { a, b } = await seed();
    await expect(queryAuditLog({ ...a, tenantId: b.tenantId })).rejects.toBeInstanceOf(AuthError);
  });
});

describe("queryPlatformAuditLog", () => {
  it("returns platform-level rows by default, everything with scope=all; superadmin only", async () => {
    const { a, admin } = await seed();
    const ctx = { actor: { id: admin.id, role: admin.role, tenantId: null, email: admin.email } };

    const platform = await queryPlatformAuditLog(ctx);
    expect(platform.items.map((i) => i.action)).toEqual(["auth.login_failed", "auth.login"]);
    expect(platform.items.every((i) => i.tenantId === null)).toBe(true);
    expect(platform.items[0].summary).toBe("Someone failed to sign in as x@y.z (invalid credentials)");

    expect((await queryPlatformAuditLog(ctx, { scope: "all" })).items).toHaveLength(6);
    expect((await queryPlatformAuditLog(ctx, { tenantId: a.tenantId })).items).toHaveLength(3);

    await expect(queryPlatformAuditLog({ actor: a.actor })).rejects.toBeInstanceOf(AuthError);
  });
});
