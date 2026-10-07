import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { AuthError } from "@/server/auth/guards";
import { createSession, destroySession } from "@/server/auth/session";
import { SETTINGS_GROUPS } from "@/server/settings/schema";
import { getSettings } from "@/server/settings";
import { resetPassword } from "@/server/auth/service";
import {
  addDomain,
  createTenant,
  listTenants,
  removeDomain,
  requirePlatformContext,
  setPrimaryDomain,
  setTenantStatus,
  updateTenant,
  type PlatformContext,
} from "@/server/platform";
import { resetDb } from "./helpers";

beforeEach(resetDb);

async function platformCtx(): Promise<PlatformContext> {
  const u = await db.user.create({ data: { role: "SUPERADMIN", tenantId: null, email: `root-${Math.random()}@qm.test` } });
  return { actor: { id: u.id, role: u.role, tenantId: null, email: u.email } };
}

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await expect(promise).rejects.toMatchObject({ code });
}

const baseInput = {
  slug: "concept",
  name: "Concept Militaria",
  currency: "eur",
  timezone: "Europe/Amsterdam",
  primaryHost: "https://Concept.Example/",
  ownerEmail: "Owner@Concept.example",
};

describe("platform access", () => {
  it("requires a SUPERADMIN session / actor", async () => {
    const ctx = await platformCtx();
    await createSession(ctx.actor.id, "SUPERADMIN");
    await expect(requirePlatformContext()).resolves.toMatchObject({ actor: { id: ctx.actor.id } });
    await destroySession();

    const tenant = await db.tenant.create({ data: { slug: "x", name: "X" } });
    const owner = await db.user.create({ data: { role: "OWNER", tenantId: tenant.id, email: "o@x.test" } });
    await createSession(owner.id, "OWNER");
    await expect(requirePlatformContext()).rejects.toBeInstanceOf(AuthError);
    await destroySession();

    // Services re-check the actor even with a hand-built context.
    const forged: PlatformContext = { actor: { id: owner.id, role: "OWNER", tenantId: tenant.id, email: owner.email } };
    await expect(listTenants(forged)).rejects.toBeInstanceOf(AuthError);
    await expect(createTenant(forged, baseInput)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("createTenant", () => {
  it("creates tenant, primary domain, every settings row and an owner invite", async () => {
    const ctx = await platformCtx();
    const res = await createTenant(ctx, baseInput);

    expect(res.tenant).toMatchObject({ slug: "concept", currency: "EUR", status: "ACTIVE" });
    expect(res.domain).toMatchObject({ host: "concept.example", isPrimary: true });
    const groups = await db.setting.findMany({ where: { tenantId: res.tenant.id }, orderBy: { group: "asc" } });
    expect(groups.map((g) => g.group).sort()).toEqual([...SETTINGS_GROUPS].sort());
    expect((await getSettings(res.tenant.id, "general")).shopName).toBe("Concept Militaria");
    expect((await getSettings(res.tenant.id, "analytics")).provider).toBe("own");

    expect(res.owner).toMatchObject({ email: "owner@concept.example", role: "OWNER", invitePending: true });
    expect(await resetPassword(res.inviteToken, "owner chosen password")).toEqual({ ok: true });

    const actions = (await db.auditLog.findMany({ where: { tenantId: res.tenant.id } })).map((a) => a.action).sort();
    expect(actions).toEqual(expect.arrayContaining(["tenant.created", "user.invited"]));
  });

  it("rejects duplicate slugs/hosts, the platform host and invalid input — atomically", async () => {
    const ctx = await platformCtx();
    await createTenant(ctx, baseInput);
    await expectServiceError(createTenant(ctx, { ...baseInput, primaryHost: "other.example" }), "CONFLICT");
    await expectServiceError(createTenant(ctx, { ...baseInput, slug: "other", primaryHost: "concept.example" }), "CONFLICT");
    expect(await db.tenant.count()).toBe(1);
    expect(await db.setting.count()).toBe(SETTINGS_GROUPS.length);

    process.env.PLATFORM_HOST ??= "localhost:3000";
    await expectServiceError(createTenant(ctx, { ...baseInput, slug: "p", primaryHost: process.env.PLATFORM_HOST }), "INVALID");
    await expectServiceError(createTenant(ctx, { ...baseInput, slug: "Bad Slug!" }), "INVALID");
    await expectServiceError(createTenant(ctx, { ...baseInput, slug: "tz", primaryHost: "tz.example", timezone: "Mars/Olympus" }), "INVALID");
    await expectServiceError(createTenant(ctx, { ...baseInput, slug: "h", primaryHost: "h.example/path" }), "INVALID");
  });
});

describe("tenant management", () => {
  it("lists tenants with stats", async () => {
    const ctx = await platformCtx();
    const { tenant } = await createTenant(ctx, baseInput);
    await db.product.create({ data: { tenantId: tenant.id, stockCode: 50000, slug: "a", title: "A", price: 100, status: "ACTIVE" } });
    await db.product.create({ data: { tenantId: tenant.id, stockCode: 50001, slug: "b", title: "B", price: 100 } });

    const [item] = await listTenants(ctx);
    expect(item).toMatchObject({
      id: tenant.id,
      primaryHost: "concept.example",
      productCount: 2,
      activeProductCount: 1,
      orders30d: 0,
      ownerCount: 1,
    });
    expect(item.lastActivityAt).toBeInstanceOf(Date); // from the audit rows
    expect(await listTenants(ctx, { search: "nomatch" })).toEqual([]);
    expect(await listTenants(ctx, { search: "concept.ex" })).toHaveLength(1);
  });

  it("updates details; currency is frozen once products exist", async () => {
    const ctx = await platformCtx();
    const { tenant } = await createTenant(ctx, baseInput);
    expect(await updateTenant(ctx, tenant.id, { currency: "usd", name: "Renamed" })).toMatchObject({ currency: "USD", name: "Renamed" });
    await db.product.create({ data: { tenantId: tenant.id, stockCode: 50000, slug: "a", title: "A", price: 100 } });
    await expectServiceError(updateTenant(ctx, tenant.id, { currency: "EUR" }), "CONFLICT");
    await expectServiceError(updateTenant(ctx, "missing", { name: "x" }), "NOT_FOUND");
  });

  it("suspending signs out the tenant's users; never deletes", async () => {
    const ctx = await platformCtx();
    const { tenant, owner } = await createTenant(ctx, baseInput);
    await db.session.create({ data: { userId: owner.id, tokenHash: "s1", expiresAt: new Date(Date.now() + 60_000) } });
    await db.session.create({ data: { userId: ctx.actor.id, tokenHash: "s2", expiresAt: new Date(Date.now() + 60_000) } });

    expect((await setTenantStatus(ctx, tenant.id, "SUSPENDED")).status).toBe("SUSPENDED");
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: ctx.actor.id } })).toBe(1);
    expect((await setTenantStatus(ctx, tenant.id, "ACTIVE")).status).toBe("ACTIVE");
    await expectServiceError(setTenantStatus(ctx, tenant.id, "DELETED" as never), "INVALID");
    expect(await db.auditLog.count({ where: { action: "tenant.status_changed", tenantId: tenant.id } })).toBe(2);
  });

  it("manages domains: normalized, unique, exactly one primary", async () => {
    const ctx = await platformCtx();
    const { tenant, domain: first } = await createTenant(ctx, baseInput);
    const other = await createTenant(ctx, { ...baseInput, slug: "other", primaryHost: "other.example", ownerEmail: "o@other.example" });

    const second = await addDomain(ctx, tenant.id, { host: "WWW.Concept.Example." });
    expect(second).toMatchObject({ host: "www.concept.example", isPrimary: false });
    await expectServiceError(addDomain(ctx, tenant.id, { host: "other.example" }), "CONFLICT");
    await expectServiceError(addDomain(ctx, tenant.id, { host: "bad host" }), "INVALID");

    await expectServiceError(removeDomain(ctx, first.id), "INVALID");
    await setPrimaryDomain(ctx, second.id);
    const domains = await db.tenantDomain.findMany({ where: { tenantId: tenant.id } });
    expect(domains.filter((d) => d.isPrimary).map((d) => d.id)).toEqual([second.id]);

    await removeDomain(ctx, first.id);
    expect(await db.tenantDomain.count({ where: { tenantId: tenant.id } })).toBe(1);

    const third = await addDomain(ctx, tenant.id, { host: "shop3.example", primary: true });
    expect(third.isPrimary).toBe(true);
    expect(await db.tenantDomain.count({ where: { tenantId: tenant.id, isPrimary: true } })).toBe(1);
    // Other tenant untouched.
    expect(await db.tenantDomain.count({ where: { tenantId: other.tenant.id, isPrimary: true } })).toBe(1);
  });
});
