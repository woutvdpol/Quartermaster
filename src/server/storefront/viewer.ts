import "server-only";
import { cache } from "react";
import { currentUser } from "@/server/auth/guards";

export type ShopViewer = { userId: string; role: "CUSTOMER" | "OWNER"; email: string; name: string | null };

/**
 * The signed-in user as far as this shop is concerned: a CUSTOMER or OWNER of `tenantId`.
 * Users of other tenants (and the superadmin) count as guests here. Memoised per request.
 */
export const getShopViewer = cache(async (tenantId: string): Promise<ShopViewer | null> => {
  const user = await currentUser();
  if (!user || user.tenantId !== tenantId) return null;
  if (user.role !== "CUSTOMER" && user.role !== "OWNER") return null;
  return { userId: user.id, role: user.role, email: user.email, name: user.name };
});
