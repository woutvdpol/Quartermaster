import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { getSession, type SessionUser } from "./session";

export class AuthError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code);
  }
}

// One session lookup per request, shared by every guard call.
export const currentSession = cache(getSession);

/** The fully signed-in user (TOTP completed), or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await currentSession();
  return session && !session.pendingTotp ? session.user : null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("UNAUTHENTICATED");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw new AuthError("FORBIDDEN");
  return user;
}

/** Staff may act on a tenant: SUPERADMIN on any tenant, OWNER only on their own. */
export function canAccessTenant(user: Pick<SessionUser, "role" | "tenantId">, tenantId: string): boolean {
  if (user.role === "SUPERADMIN") return true;
  return user.role === "OWNER" && user.tenantId === tenantId;
}

export async function requireTenantAccess(tenantId: string): Promise<SessionUser> {
  const user = await requireRole("SUPERADMIN", "OWNER");
  if (!canAccessTenant(user, tenantId)) throw new AuthError("FORBIDDEN");
  return user;
}

/** For pages: redirects instead of throwing. */
export async function requireAdminPage(): Promise<SessionUser> {
  const session = await currentSession();
  if (!session) redirect("/admin/login");
  if (session.pendingTotp) redirect("/admin/login/2fa");
  if (session.user.role === "CUSTOMER") redirect("/");
  return session.user;
}
