/*
 * Concept500 tier → Quartermaster package (docs/modules.md, "Migratie"). Pure; used by the ETL.
 * bronze → START, silver → PRO, gold → COMPLETE. Limits the legacy shop had set explicitly become overrides.
 * The legacy newsletter switch (`emailer`) becomes the newsletter module when the package lacks it.
 */
import { PLANS, type PlanId } from "./catalog";

export type LegacyPlatformSettings = {
  plan?: string | null;
  productLimit?: number | null;
  photoLimit?: number | null;
  newsletterEnabled?: boolean | null;
  newsletterQuota?: number | null;
};

export type LegacyPlan = {
  plan: PlanId;
  productLimit: number | null;
  photoLimit: number | null;
  newsletterQuota: number | null;
  /** Whether the newsletter must be granted as an extra module. */
  newsletterModule: boolean;
};

const TIERS: Record<string, PlanId> = { bronze: "START", silver: "PRO", gold: "COMPLETE" };

/** Legacy quota default (the old settings default); anything else was set on purpose. */
const LEGACY_DEFAULT_QUOTA = 1000;

export function planFromLegacy(s: LegacyPlatformSettings): LegacyPlan {
  const plan = TIERS[(s.plan ?? "").toLowerCase()] ?? "START";
  const quota = s.newsletterQuota ?? null;
  return {
    plan,
    productLimit: s.productLimit ?? null,
    photoLimit: s.photoLimit ?? null,
    newsletterQuota: quota === null || quota === LEGACY_DEFAULT_QUOTA ? null : quota,
    newsletterModule: Boolean(s.newsletterEnabled) && !PLANS[plan].modules.includes("newsletter"),
  };
}
