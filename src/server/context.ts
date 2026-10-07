import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getAdminTenantContext } from "@/lib/admin-tenant";
import { AuthError, canAccessTenant, requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";

/**
 * Every admin service function takes a ServiceContext as its first argument.
 * Rules for services:
 *  - Always filter/write with `ctx.tenantId` explicitly (tenant isolation lives here).
 *  - Mutations run their own transaction where more than one row changes, and call `audit()`.
 *  - Inputs are validated with Zod inside the service, never trusted from the caller.
 */
export type ServiceContext = {
  tenantId: string;
  actor: Pick<SessionUser, "id" | "role" | "tenantId" | "email">;
};

export const ADMIN_TENANT_COOKIE = "qm_tenant";

/**
 * Resolves the tenant a staff member is working on:
 * OWNER → their own tenant; SUPERADMIN → the tenant chosen in the switcher (cookie),
 * falling back to the first active tenant. A chosen tenant that is not ACTIVE is FORBIDDEN.
 *
 * Cached per request: the layout, the page and every Suspense'd card share one session lookup and
 * one tenant lookup (the switcher list from getAdminTenantContext, which the sidebar needs anyway).
 * The returned object is stable within a request, so `cache()`d helpers keyed on it dedupe too.
 */
export const requireStaffContext = cache(async (): Promise<ServiceContext> => {
  const user = await requireRole("SUPERADMIN", "OWNER");
  let tenantId = user.tenantId;
  if (user.role === "SUPERADMIN") {
    const [{ switchable }, cookieStore] = await Promise.all([getAdminTenantContext(user), cookies()]);
    const chosen = cookieStore.get(ADMIN_TENANT_COOKIE)?.value;
    const tenant = chosen
      ? switchable.find((t) => t.id === chosen && t.status === "ACTIVE")
      : switchable.find((t) => t.status === "ACTIVE");
    tenantId = tenant?.id ?? null;
  }
  if (!tenantId || !canAccessTenant(user, tenantId)) throw new AuthError("FORBIDDEN");
  return { tenantId, actor: { id: user.id, role: user.role, tenantId: user.tenantId, email: user.email } };
});

/** Domain errors that UI layers can map to messages. */
export class ServiceError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID" | "FORBIDDEN" | "UNAVAILABLE",
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}
