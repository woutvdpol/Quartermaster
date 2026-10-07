import "server-only";
import { cookies } from "next/headers";
import { db } from "@/server/db";
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
 * falling back to the first active tenant.
 */
export async function requireStaffContext(): Promise<ServiceContext> {
  const user = await requireRole("SUPERADMIN", "OWNER");
  let tenantId = user.tenantId;
  if (user.role === "SUPERADMIN") {
    const chosen = (await cookies()).get(ADMIN_TENANT_COOKIE)?.value;
    const tenant = chosen
      ? await db.tenant.findFirst({ where: { id: chosen, status: "ACTIVE" }, select: { id: true } })
      : await db.tenant.findFirst({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true } });
    tenantId = tenant?.id ?? null;
  }
  if (!tenantId || !canAccessTenant(user, tenantId)) throw new AuthError("FORBIDDEN");
  return { tenantId, actor: { id: user.id, role: user.role, tenantId: user.tenantId, email: user.email } };
}

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
