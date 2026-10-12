import "server-only";
import { db } from "@/server/db";
import { getShopCustomer } from "@/server/customer-auth/current";

/*
 * Who may use a winner's payment link (addition next to src/server/auctions/pay.ts, which validates the
 * token but does not expose the order's customer). Same rule as the offers' personal checkout link —
 * the token is the credential — plus: a signed-in customer must be the winner. A guest with a valid
 * token pays as the winner (the order's e-mail is fixed; it is not an input).
 */

export type PayAccess = "ok" | "wrong-account";

/** Call after the token was validated (getAuctionPayView / submit). `lotId` = the view's lot id. */
export async function payAccess(tenantId: string, lotId: string): Promise<PayAccess> {
  const c = await getShopCustomer();
  if (!c || c.tenant.id !== tenantId) return "ok";
  const lot = await db.auctionLot.findFirst({ where: { id: lotId, tenantId }, select: { order: { select: { customerId: true } } } });
  const winner = lot?.order?.customerId ?? null;
  return !winner || winner === c.customer.id ? "ok" : "wrong-account";
}
