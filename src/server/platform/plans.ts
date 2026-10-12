import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError } from "@/server/context";
import { parseInput } from "@/server/catalog/errors";
import { getEntitlements } from "@/server/modules";
import { MODULE_IDS, PLAN_IDS, type ModuleId } from "@/server/modules/catalog";
import { assertPlatformActor, type PlatformContext } from "./context";

/*
 * Superadmin control over a shop's package, extra modules, limits and newsletter credits
 * (docs/modules.md, phase 1: by hand; phase 3 adds subscriptions). Every change is audited as
 * `plan.*`, which also refreshes the shop's storefront feature flags (storefront/cache.ts).
 */

const idSchema = z.string().min(1).max(64);
const limit = z.int().min(0).max(10_000_000).nullable();

const planSchema = z.object({
  plan: z.enum(PLAN_IDS),
  productLimit: limit,
  photoLimit: z.int().min(1).max(100).nullable(),
  storageGb: z.number().min(0).max(10_000).nullable(),
  // -1 = unlimited (newsletter quota convention).
  newsletterQuota: z.int().min(-1).max(10_000_000).nullable(),
});
export type TenantPlanInput = z.input<typeof planSchema>;

const moduleSchema = z.object({
  moduleId: z.enum(MODULE_IDS),
  // null = remove the extra module (package modules cannot be removed per module).
  status: z.enum(["TRIAL", "ACTIVE"]).nullable(),
  trialDays: z.int().min(1).max(365).default(14),
});
export type TenantModuleInput = z.input<typeof moduleSchema>;

async function requireTenant(tenantId: string) {
  const id = parseInput(idSchema, tenantId);
  const tenant = await db.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!tenant) throw new ServiceError("NOT_FOUND", "Tenant not found");
  return id;
}

/** Package, overrides, extra modules, credits and the resulting entitlements of one shop. */
export async function getTenantPlan(ctx: PlatformContext, tenantId: string) {
  assertPlatformActor(ctx);
  const id = await requireTenant(tenantId);
  const [plan, modules, entitlements] = await Promise.all([
    db.tenantPlan.findUnique({ where: { tenantId: id } }),
    db.tenantModule.findMany({ where: { tenantId: id }, orderBy: { moduleId: "asc" } }),
    getEntitlements(id),
  ]);
  return { plan, modules, entitlements };
}

export async function setTenantPlan(ctx: PlatformContext, tenantId: string, input: TenantPlanInput) {
  assertPlatformActor(ctx);
  const id = await requireTenant(tenantId);
  const data = parseInput(planSchema, input);
  const before = await db.tenantPlan.findUnique({ where: { tenantId: id } });
  const row = await db.tenantPlan.upsert({
    where: { tenantId: id },
    create: { tenantId: id, ...data, source: "MANUAL" },
    update: { ...data, source: "MANUAL" },
  });
  await audit({
    action: "plan.update",
    tenantId: id,
    actorId: ctx.actor.id,
    entity: "TenantPlan",
    entityId: id,
    data: { from: before ? { plan: before.plan, productLimit: before.productLimit, photoLimit: before.photoLimit, storageGb: before.storageGb, newsletterQuota: before.newsletterQuota } : null, to: data },
  });
  return row;
}

/** Grants an extra module (ACTIVE or a trial of `trialDays`) or removes it (status null). */
export async function setTenantModule(ctx: PlatformContext, tenantId: string, input: TenantModuleInput) {
  assertPlatformActor(ctx);
  const id = await requireTenant(tenantId);
  const data = parseInput(moduleSchema, input);
  const moduleId: ModuleId = data.moduleId;
  if (data.status === null) {
    await db.tenantModule.updateMany({ where: { tenantId: id, moduleId }, data: { status: "CANCELLED" } });
  } else {
    const trialEndsAt = data.status === "TRIAL" ? new Date(Date.now() + data.trialDays * 24 * 60 * 60 * 1000) : null;
    await db.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: id, moduleId } },
      create: { tenantId: id, moduleId, status: data.status, source: "MANUAL", trialEndsAt },
      update: { status: data.status, source: "MANUAL", trialEndsAt },
    });
  }
  await audit({
    action: "plan.module",
    tenantId: id,
    actorId: ctx.actor.id,
    entity: "TenantModule",
    entityId: `${id}:${moduleId}`,
    data: { module: moduleId, status: data.status ?? "CANCELLED", trialDays: data.status === "TRIAL" ? data.trialDays : undefined },
  });
}

/** Adds (or with a negative amount corrects) purchased newsletter credits; the balance never goes below 0. */
export async function addNewsletterCredits(ctx: PlatformContext, tenantId: string, amount: number) {
  assertPlatformActor(ctx);
  const id = await requireTenant(tenantId);
  const n = parseInput(z.int().min(-10_000_000).max(10_000_000).refine((v) => v !== 0, "Enter a number of mails"), amount);
  const balance = await db.$transaction(async (tx) => {
    const row = await tx.tenantPlan.upsert({ where: { tenantId: id }, create: { tenantId: id }, update: {}, select: { newsletterCredits: true } });
    const next = Math.max(0, row.newsletterCredits + n);
    await tx.tenantPlan.update({ where: { tenantId: id }, data: { newsletterCredits: next } });
    return next;
  });
  await audit({ action: "plan.credits", tenantId: id, actorId: ctx.actor.id, entity: "TenantPlan", entityId: id, data: { amount: n, balance } });
  return { balance };
}
