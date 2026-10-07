import "server-only";
import { AuthError, currentSession } from "@/server/auth/guards";

/** The signed-in staff member and their current session id (for "this device" / keep-signed-in). */
export async function requireAccount() {
  const session = await currentSession();
  if (!session || session.pendingTotp) throw new AuthError("UNAUTHENTICATED");
  const { user } = session;
  if (user.role !== "SUPERADMIN" && user.role !== "OWNER") throw new AuthError("FORBIDDEN");
  return { user, sessionId: session.sessionId };
}
