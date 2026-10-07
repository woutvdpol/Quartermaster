import "server-only";
import { AuthError, requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";

/**
 * Context for platform-level (Quartermaster admin) services. Unlike ServiceContext there is no
 * tenant: these functions act across tenants and are SUPERADMIN-only.
 */
export type PlatformContext = {
  actor: Pick<SessionUser, "id" | "role" | "tenantId" | "email">;
};

/** Resolves the signed-in SUPERADMIN for a platform action (throws AuthError otherwise). */
export async function requirePlatformContext(): Promise<PlatformContext> {
  const user = await requireRole("SUPERADMIN");
  return { actor: { id: user.id, role: user.role, tenantId: user.tenantId, email: user.email } };
}

/** Defense in depth: every platform service re-checks the actor, whoever built the context. */
export function assertPlatformActor(ctx: PlatformContext): void {
  if (ctx?.actor?.role !== "SUPERADMIN" || ctx.actor.tenantId !== null) throw new AuthError("FORBIDDEN");
}
