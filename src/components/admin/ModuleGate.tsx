import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState, buttonClasses } from "@/components/admin/ui";
import { PageHeader } from "@/components/admin/PageHeader";
import { requireStaffContext } from "@/server/context";
import { getEntitlements } from "@/server/modules";
import { MODULES, PLANS, PLAN_IDS, type ModuleId } from "@/server/modules/catalog";

function euros(cents: number): string {
  return `€${(cents / 100).toLocaleString("en-NL", { maximumFractionDigits: 2 })}`;
}

/**
 * Wraps the admin screens of a paid module (docs/modules.md). Without the module it shows what the
 * module does, its price and which packages include it, instead of the screens. A convenience only:
 * layouts do not re-render on navigation, so services enforce the module themselves (assertModule).
 */
export async function ModuleGate({ module, children }: { module: ModuleId; children: ReactNode }) {
  const ctx = await requireStaffContext();
  const { modules } = await getEntitlements(ctx.tenantId);
  if (modules.has(module)) return <>{children}</>;

  const def = MODULES[module];
  const packages = PLAN_IDS.filter((p) => PLANS[p].modules.includes(module)).map((p) => PLANS[p].name);
  const superadmin = ctx.actor.role === "SUPERADMIN";
  return (
    <>
      <PageHeader crumb="Not in your package" title={def.name} />
      <div className="p-4 md:px-[22px] md:py-5">
        <div className="rounded-card border border-line bg-panel shadow-card">
          <EmptyState
            title={`${def.name} is not part of your package`}
            body={`${def.description} Add it for ${euros(def.priceCents)} per month, or choose the ${packages.join(" or ")} package.`}
            action={
              superadmin ? (
                <Link href={`/admin/platform/${ctx.tenantId}`} className={buttonClasses({ variant: "primary" })}>
                  Manage this shop&apos;s modules
                </Link>
              ) : (
                // Phase 2 replaces this with a trial / buy button (docs/modules.md).
                <p className="text-[13px] text-muted">Contact Quartermaster support to add it.</p>
              )
            }
          />
        </div>
      </div>
    </>
  );
}

/**
 * True when the active shop lacks the module. Module pages return null early on this: Next renders a
 * page in parallel with its layout, so without it the page would still query (and log UNAVAILABLE)
 * behind the ModuleGate that is shown instead.
 */
export async function moduleLocked(id: ModuleId): Promise<boolean> {
  const ctx = await requireStaffContext();
  return !(await getEntitlements(ctx.tenantId)).modules.has(id);
}
