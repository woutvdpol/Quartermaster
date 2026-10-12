import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import { MODULES, PLANS, type ModuleId, type PlanId } from "./catalog";
import { resolveEntitlements, type Entitlements } from "./resolve";

/*
 * Entitlements per shop (docs/modules.md). One cached lookup per request, used by:
 *   1. the admin nav (locked items)        3. services (assertModule — the real enforcement)
 *   2. admin pages (ModuleGate)             4. the storefront `features` map    5. jobs and crons
 * Outside a React request (worker, scripts) `cache` does not memoise, so jobs read fresh rows.
 */

export type { Entitlements } from "./resolve";
export { MODULES, PLANS, MODULE_IDS, type ModuleId, type PlanId } from "./catalog";

async function load(tenantId: string): Promise<Entitlements> {
  const [planRow, moduleRows] = await Promise.all([
    db.tenantPlan.findUnique({
      where: { tenantId },
      select: { plan: true, productLimit: true, photoLimit: true, storageGb: true, newsletterQuota: true },
    }),
    db.tenantModule.findMany({ where: { tenantId }, select: { moduleId: true, status: true, trialEndsAt: true } }),
  ]);
  return resolveEntitlements(planRow, moduleRows);
}

export const getEntitlements = cache(load);

export async function hasModule(tenantId: string, id: ModuleId): Promise<boolean> {
  return (await getEntitlements(tenantId)).modules.has(id);
}

/** Throws UNAVAILABLE when the shop does not have the module. Call at the top of every module service entry. */
export async function assertModule(ctx: Pick<ServiceContext, "tenantId">, id: ModuleId): Promise<void> {
  if (await hasModule(ctx.tenantId, id)) return;
  throw new ServiceError("UNAVAILABLE", `${MODULES[id].name} is not part of your package.`, { module: id });
}

/** Storefront feature flags: one boolean per module (public, cached with the shop context). */
export async function moduleFeatures(tenantId: string): Promise<Record<ModuleId, boolean>> {
  const { modules } = await getEntitlements(tenantId);
  return Object.fromEntries(Object.keys(MODULES).map((id) => [id, modules.has(id as ModuleId)])) as Record<ModuleId, boolean>;
}

/** Tenant ids that have a module, for crons that sweep across shops. */
export async function tenantsWithModule(id: ModuleId): Promise<Set<string>> {
  const [plans, extras] = await Promise.all([
    db.tenantPlan.findMany({ select: { tenantId: true, plan: true } }),
    db.tenantModule.findMany({ where: { moduleId: id, status: { not: "CANCELLED" } }, select: { tenantId: true, status: true, trialEndsAt: true } }),
  ]);
  const now = new Date();
  const out = new Set<string>();
  for (const p of plans) if (PLANS[p.plan].modules.includes(id)) out.add(p.tenantId);
  for (const m of extras) if (m.status !== "TRIAL" || !m.trialEndsAt || m.trialEndsAt > now) out.add(m.tenantId);
  return out;
}

/** Creates the plan row for a new shop. */
export async function createDefaultPlan(tenantId: string, plan: PlanId = "START", tx: Pick<typeof db, "tenantPlan"> = db) {
  await tx.tenantPlan.create({ data: { tenantId, plan } });
}
