import "server-only";
import { cache } from "react";
import { requestClientIp } from "@/server/request-meta";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/guards";
import { getRequestTenant } from "@/server/tenant";
import { ensureCustomer } from "./service";
import { loginHref } from "./redirect";

/*
 * "Who is the logged-in customer on this shop?" The session cookie (qm_session) is shared with the
 * admin, so a shop owner browsing their own storefront also has a session — the shop must only treat
 * a fully signed-in CUSTOMER of THIS host's tenant as a logged-in customer. Everyone else is a guest.
 */

export type ShopCustomer = NonNullable<Awaited<ReturnType<typeof getShopCustomer>>>;

export const getShopCustomer = cache(async () => {
  const tenant = await getRequestTenant();
  if (!tenant) return null;
  const session = await currentSession();
  if (!session || session.pendingTotp) return null;
  const { user } = session;
  if (user.role !== "CUSTOMER" || user.tenantId !== tenant.id) return null;
  const customer = await ensureCustomer(user);
  return { tenant, user, customer, sessionId: session.sessionId };
});

/** For account pages: the customer, or a redirect to `/login?next=<returnTo>`. */
export async function requireShopCustomer(returnTo: string): Promise<ShopCustomer> {
  const c = await getShopCustomer();
  if (!c) redirect(loginHref(returnTo));
  return c;
}

/** A CUSTOMER session of this shop that still waits for its TOTP code. */
export async function hasPendingCustomerTotp(): Promise<boolean> {
  const tenant = await getRequestTenant();
  const session = await currentSession();
  return !!tenant && !!session?.pendingTotp && session.user.role === "CUSTOMER" && session.user.tenantId === tenant.id;
}

/** Client IP of the current request (for rate limits); null when unknown — see src/server/request-meta.ts. */
export async function clientIp(): Promise<string | null> {
  return requestClientIp();
}
