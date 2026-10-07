import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";

/*
 * Local read (no service exposes it to staff): the tenant's display settings.
 * Shared by the dashboard and sourcing screens.
 */
export const getTenantFormat = cache(async (ctx: ServiceContext) => {
  const t = await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { currency: true, timezone: true } });
  return { currency: t?.currency ?? "EUR", timeZone: t?.timezone ?? "Europe/Amsterdam" };
});
