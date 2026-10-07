import "server-only";
import { getShopCustomer } from "@/server/customer-auth/current";

/**
 * The signed-in shop customer for a tenant, or null for guests. Delegates to customer-auth's
 * getShopCustomer (a fully signed-in CUSTOMER of the request host's tenant); staff sessions and
 * customers of other shops are guests. Services take this as a plain value so tests can pass one.
 */
export type ShopViewer = { userId: string; email: string; name: string | null; customerId: string | null };

export async function getShopViewer(tenantId: string): Promise<ShopViewer | null> {
  const c = await getShopCustomer();
  if (!c || c.tenant.id !== tenantId) return null;
  return { userId: c.user.id, email: c.user.email, name: c.user.name, customerId: c.customer.id };
}
