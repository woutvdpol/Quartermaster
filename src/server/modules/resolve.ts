/*
 * What a shop may use: package + modules on top + limit overrides → entitlements (docs/modules.md).
 * Pure (no DB) so it is unit tested; src/server/modules/index.ts loads the rows and caches the result.
 */
import { MODULE_IDS, NEWSLETTER_MODULE_QUOTA, PLANS, isModuleId, type ModuleId, type PlanId, type PlanLimits } from "./catalog";

export type PlanRow = {
  plan: PlanId;
  productLimit: number | null;
  photoLimit: number | null;
  storageGb: number | null;
  newsletterQuota: number | null;
} | null;

export type ModuleRow = {
  moduleId: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  trialEndsAt: Date | null;
};

export type Entitlements = {
  plan: PlanId;
  /** Every module the shop may use right now (package modules + granted extra modules). */
  modules: ReadonlySet<ModuleId>;
  /** Extra modules currently in a trial, with their end date. */
  trials: ReadonlyMap<ModuleId, Date | null>;
  limits: PlanLimits;
};

/** A legacy newsletter quota of -1 meant "unlimited". */
function quotaOverride(v: number | null): number | null | undefined {
  if (v === null) return undefined;
  return v < 0 ? null : v;
}

export function resolveEntitlements(planRow: PlanRow, moduleRows: readonly ModuleRow[], now: Date = new Date()): Entitlements {
  const plan = planRow?.plan ?? "START";
  const def = PLANS[plan];
  const modules = new Set<ModuleId>(def.modules);
  const trials = new Map<ModuleId, Date | null>();

  for (const row of moduleRows) {
    if (!isModuleId(row.moduleId)) continue; // a module removed from the catalog grants nothing
    if (row.status === "CANCELLED") continue;
    if (row.status === "TRIAL") {
      if (row.trialEndsAt && row.trialEndsAt <= now) continue;
      if (!modules.has(row.moduleId)) trials.set(row.moduleId, row.trialEndsAt);
    }
    modules.add(row.moduleId);
  }

  let newsletterQuota = def.limits.newsletterQuota;
  if (modules.has("newsletter") && !def.modules.includes("newsletter")) newsletterQuota = NEWSLETTER_MODULE_QUOTA;
  const override = quotaOverride(planRow?.newsletterQuota ?? null);
  if (override !== undefined) newsletterQuota = override;

  return {
    plan,
    modules,
    trials,
    limits: {
      productLimit: planRow?.productLimit ?? def.limits.productLimit,
      photoLimit: planRow?.photoLimit ?? def.limits.photoLimit,
      storageGb: planRow?.storageGb ?? def.limits.storageGb,
      newsletterQuota,
    },
  };
}

/** Every module granted (for superadmin/system contexts and tests). */
export const ALL_MODULES: ReadonlySet<ModuleId> = new Set(MODULE_IDS);
