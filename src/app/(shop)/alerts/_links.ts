import "server-only";
import { stopWishlistAlertSigned, unsubscribeSavedSearchSigned } from "@/server/alerts";

/** Query of an unsubscribe link: saved search (`s`) or wishlist item (`c` + `p`). */
export type UnsubscribeTarget =
  | { kind: "search"; tenantId: string; savedSearchId: string; sig: string }
  | { kind: "wishlist"; tenantId: string; customerId: string; productId: string; sig: string };

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 128) : "");

export function readUnsubscribeTarget(q: Record<string, unknown>): UnsubscribeTarget | null {
  const tenantId = str(q.t);
  const sig = str(q.sig);
  if (!tenantId || !sig) return null;
  if (q.s) return { kind: "search", tenantId, savedSearchId: str(q.s), sig };
  if (q.c && q.p) return { kind: "wishlist", tenantId, customerId: str(q.c), productId: str(q.p), sig };
  return null;
}

/** Performs the unsubscribe. `hostTenantId`: tenant of the request host (links of other shops are invalid). */
export async function performUnsubscribe(target: UnsubscribeTarget | null, hostTenantId: string | null): Promise<boolean> {
  if (!target || (hostTenantId && hostTenantId !== target.tenantId)) return false;
  const res =
    target.kind === "search"
      ? await unsubscribeSavedSearchSigned(target)
      : await stopWishlistAlertSigned(target);
  return res.ok;
}
