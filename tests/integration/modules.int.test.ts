import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { AuthError } from "@/server/auth/guards";
import { ServiceError } from "@/server/context";
import { createProduct, setStatus } from "@/server/catalog/products";
import { createCampaign, getNewsletterQuota, sendCampaign } from "@/server/newsletter";
import { getEntitlements } from "@/server/modules";
import { addNewsletterCredits, getTenantPlan, setTenantModule, setTenantPlan, type PlatformContext } from "@/server/platform";
import { createTenantContext, resetDb } from "./helpers";
import { enableNewsletter, installHarness } from "./mail-harness";

// Paid modules, phase 1 (docs/modules.md): product limit, superadmin controls, newsletter credits.
vi.mock("next/server", () => ({ connection: async () => {} }));

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
});
afterEach(() => h.uninstall());

async function platformCtx(): Promise<PlatformContext> {
  const u = await db.user.create({ data: { role: "SUPERADMIN", tenantId: null, email: `root-${Math.random()}@qm.test` } });
  return { actor: { id: u.id, role: u.role, tenantId: null, email: u.email } };
}

const forSale = (title: string) => ({ title, price: 1000, quantity: 1, status: "ACTIVE" as const });

describe("product limit", () => {
  it("counts products for sale only; drafts are always allowed", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    await db.tenantPlan.update({ where: { tenantId: ctx.tenantId }, data: { productLimit: 2 } });

    await createProduct(ctx, forSale("A"));
    await createProduct(ctx, forSale("B"));
    await expect(createProduct(ctx, forSale("C"))).rejects.toMatchObject({ code: "UNAVAILABLE", details: { limit: "products", max: 2, current: 2 } });

    // Drafts never count, but activating one over the limit is refused.
    const draft = await createProduct(ctx, { title: "Draft", price: 1000, quantity: 1 });
    await expect(setStatus(ctx, [draft.id], "ACTIVE")).rejects.toMatchObject({ code: "UNAVAILABLE" });

    // Raising the limit (or Complete = unlimited) lets it through; existing products were never taken offline.
    await db.tenantPlan.update({ where: { tenantId: ctx.tenantId }, data: { productLimit: null, plan: "COMPLETE" } });
    expect(await setStatus(ctx, [draft.id], "ACTIVE")).toEqual({ updated: 1 });
    expect(await db.product.count({ where: { tenantId: ctx.tenantId, status: "ACTIVE" } })).toBe(3);
  });

  it("uses the package default when there is no override", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    expect((await getEntitlements(ctx.tenantId)).limits.productLimit).toBe(100);
  });
});

describe("superadmin plan controls", () => {
  it("changes package, grants and removes modules, and audits every change", async () => {
    const root = await platformCtx();
    const shop = await createTenantContext({ plan: "START" });

    await setTenantPlan(root, shop.tenantId, { plan: "PRO", productLimit: 750, photoLimit: null, storageGb: null, newsletterQuota: null });
    await setTenantModule(root, shop.tenantId, { moduleId: "auctions", status: "ACTIVE" });
    await setTenantModule(root, shop.tenantId, { moduleId: "fairs", status: "TRIAL", trialDays: 14 });
    let info = await getTenantPlan(root, shop.tenantId);
    expect(info.entitlements.plan).toBe("PRO");
    expect(info.entitlements.limits.productLimit).toBe(750);
    expect([...info.entitlements.modules]).toEqual(expect.arrayContaining(["offers", "newsletter", "auctions", "fairs"]));
    expect(info.entitlements.trials.has("fairs")).toBe(true);

    await setTenantModule(root, shop.tenantId, { moduleId: "auctions", status: null });
    info = await getTenantPlan(root, shop.tenantId);
    expect(info.entitlements.modules.has("auctions")).toBe(false);
    expect(info.modules.find((m) => m.moduleId === "auctions")?.status).toBe("CANCELLED"); // kept, not deleted

    const actions = (await db.auditLog.findMany({ where: { tenantId: shop.tenantId, action: { startsWith: "plan." } } })).map((a) => a.action);
    expect(actions.sort()).toEqual(["plan.module", "plan.module", "plan.module", "plan.update"]);
  });

  it("is superadmin only and validates input", async () => {
    const shop = await createTenantContext();
    const owner = { actor: shop.actor } as PlatformContext;
    await expect(setTenantPlan(owner, shop.tenantId, { plan: "START", productLimit: null, photoLimit: null, storageGb: null, newsletterQuota: null })).rejects.toBeInstanceOf(AuthError);
    const root = await platformCtx();
    await expect(setTenantModule(root, shop.tenantId, { moduleId: "nope" as never, status: "ACTIVE" })).rejects.toBeInstanceOf(ServiceError);
    await expect(setTenantPlan(root, "missing", { plan: "START", productLimit: null, photoLimit: null, storageGb: null, newsletterQuota: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("newsletter credits", () => {
  it("pays the part of a campaign that does not fit the monthly quota, and never goes negative", async () => {
    const root = await platformCtx();
    const ctx = await createTenantContext();
    await enableNewsletter(ctx.tenantId, 3);
    await db.newsletterSubscriber.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({ tenantId: ctx.tenantId, email: `s${i}@example.test`, confirmedAt: new Date() })),
    });

    // 5 recipients, quota 3, no credits → refused.
    const first = await createCampaign(ctx, { subject: "A", body: "B" });
    await expect(sendCampaign(ctx, first.id)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await addNewsletterCredits(root, ctx.tenantId, 10)).toEqual({ balance: 10 });
    await sendCampaign(ctx, first.id);
    expect((await db.newsletterCampaign.findUniqueOrThrow({ where: { id: first.id } })).creditsUsed).toBe(2);
    expect(await getNewsletterQuota(ctx)).toMatchObject({ quota: 3, used: 3, remaining: 0, credits: 8 });

    // A correction below zero clamps to 0.
    expect(await addNewsletterCredits(root, ctx.tenantId, -50)).toEqual({ balance: 0 });
  });
});
