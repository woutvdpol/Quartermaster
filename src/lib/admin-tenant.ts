import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";

/*
 * Which shop the admin is working on.
 * - OWNER: always their own tenant.
 * - SUPERADMIN: chosen with the tenant switcher, stored in the `qm_tenant` cookie (set by
 *   selectTenantAction after a canAccessTenant check). Falls back to the first shop.
 *
 * The cookie is only a preference: it is re-validated against the tenant list on every request,
 * and mutations must still call requireTenantAccess() for the tenant they touch.
 */

export const TENANT_COOKIE = "qm_tenant";

export type AdminTenant = { id: string; name: string; slug: string; status: string };

export type AdminTenantContext = {
  active: AdminTenant | null;
  /** Shops the user may switch between (SUPERADMIN only; empty for OWNER). */
  switchable: AdminTenant[];
};

const tenantSelect = { id: true, name: true, slug: true, status: true } as const;

export const getAdminTenantContext = cache(async (user: SessionUser): Promise<AdminTenantContext> => {
  if (user.role === "SUPERADMIN") {
    const tenants = await db.tenant.findMany({ select: tenantSelect, orderBy: { name: "asc" } });
    const selectedId = (await cookies()).get(TENANT_COOKIE)?.value;
    const active = tenants.find((t) => t.id === selectedId) ?? tenants[0] ?? null;
    return { active, switchable: tenants };
  }
  if (user.tenantId) {
    const active = await db.tenant.findUnique({ where: { id: user.tenantId }, select: tenantSelect });
    return { active, switchable: [] };
  }
  return { active: null, switchable: [] };
});
