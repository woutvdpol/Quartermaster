"use server";

import { cookies } from "next/headers";
import { db } from "@/server/db";
import { canAccessTenant, requireUser } from "@/server/auth/guards";
import { TENANT_COOKIE } from "@/lib/admin-tenant";

/** Switches the shop a SUPERADMIN is working on. Owners cannot switch (canAccessTenant fails). */
export async function selectTenantAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenantId = formData.get("tenantId");
  if (typeof tenantId !== "string" || tenantId.length === 0 || tenantId.length > 64) return;
  if (!canAccessTenant(user, tenantId)) return;
  const exists = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!exists) return;
  (await cookies()).set(TENANT_COOKIE, tenantId, {
    path: "/admin",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}
