import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";

/*
 * The active shop's display basics (name, currency, time zone, primary host), read ONCE per request.
 *
 * Admin pages, dashboard cards and services all need the tenant's currency/time zone; before this
 * module every route folder (and several services) ran its own `tenants` lookup, so one dashboard
 * render queried the same row 4–6 times. `cache()` dedupes per React server request; outside a
 * request (jobs, tests) it is a pass-through, so values are never stale across requests.
 */

export type TenantDisplay = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timeZone: string;
  /** Primary domain, else the oldest domain, else null. */
  primaryHost: string | null;
};

type Row = { id: string; name: string; slug: string; currency: string; timezone: string; host: string | null };

/** Display basics for a tenant, or null when it does not exist. One round trip (domain via subquery). */
export const getTenantDisplay = cache(async (tenantId: string): Promise<TenantDisplay | null> => {
  const rows = await db.$queryRaw<Row[]>`
    SELECT t.id, t.name, t.slug, t.currency, t.timezone,
           (SELECT d.host FROM tenant_domains d WHERE d."tenantId" = t.id
             ORDER BY d."isPrimary" DESC, d."createdAt" ASC LIMIT 1) AS host
      FROM tenants t
     WHERE t.id = ${tenantId}`;
  const t = rows[0];
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    currency: t.currency.trim(),
    timeZone: t.timezone,
    primaryHost: t.host,
  };
});

/** Like getTenantDisplay, but NOT_FOUND when the tenant does not exist (for services). */
export async function requireTenantDisplay(tenantId: string): Promise<TenantDisplay> {
  const t = await getTenantDisplay(tenantId);
  if (!t) throw new ServiceError("NOT_FOUND", "Tenant not found");
  return t;
}
