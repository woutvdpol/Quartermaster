import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { DEFAULT_CURRENCY } from "@/components/admin/ui/money-utils";
import { DEFAULT_TIME_ZONE } from "@/components/admin/ui/date-utils";

/**
 * Display settings of the active shop (currency + time zone) for money/date rendering.
 * No service exposes these yet, so this is a small local read (reported in the UI handoff).
 */
const loadTenantDisplay = cache(async (tenantId: string) => {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { currency: true, timezone: true },
  });
  return {
    currency: tenant?.currency ?? DEFAULT_CURRENCY,
    timeZone: tenant?.timezone ?? DEFAULT_TIME_ZONE,
  };
});
export function getTenantDisplay(ctx: ServiceContext) {
  return loadTenantDisplay(ctx.tenantId);
}
export type TenantDisplay = Awaited<ReturnType<typeof getTenantDisplay>>;
