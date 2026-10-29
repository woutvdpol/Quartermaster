import "server-only";
import { cache } from "react";
import { currentUser } from "@/server/auth/guards";
import { isSetupPending, storefrontAccess } from "@/server/onboarding/setup-rules";
import { isTrialEnded } from "@/server/onboarding/trial-rules";
import { getRequestScope } from "@/server/tenant";

/*
 * "Coming soon" for shops that are still in the setup wizard (Tenant.setupState not null and
 * setupCompletedAt null). Existing shops (setupState null) are never affected and pay no extra query.
 *
 * - Visitors and customers get the themed "Opening soon" page instead of any shop page (the shop
 *   layout swaps it in), with noindex metadata; robots.txt disallows everything and the sitemap is empty.
 *   Status: 200 + noindex. App Router layouts cannot set an HTTP status, and a 503 from the proxy would
 *   need a DB lookup there (the proxy does optimistic checks only). noindex + robots disallow keep the
 *   placeholder out of search engines just as well; the page is not an outage, so no Retry-After.
 * - Shop actions (cart, checkout, account, offers, alerts, sell) resolve their tenant through
 *   `getOpenShopTenant()`, so they fail like on an unknown host while the shop is not open.
 * - Signed-in staff of the tenant (its OWNERs) see the real shop with a "Not live yet" ribbon.
 *
 * The same gate closes a shop whose free trial has ended (Tenant.trialEndsAt passed, docs/signup-modes.md):
 * reason "closed" → visitors get "Temporarily closed" instead of "Opening soon"; the owner keeps the shop.
 */

export type LaunchState = { prelaunch: false } | { prelaunch: true; staff: boolean; reason: "setup" | "closed" };

export const getLaunchState = cache(async (): Promise<LaunchState> => {
  const scope = await getRequestScope();
  if (scope.kind !== "tenant") return { prelaunch: false };
  const reason = isSetupPending(scope.tenant) ? "setup" : isTrialEnded(scope.tenant) ? "closed" : null;
  if (!reason) return { prelaunch: false };
  // Only shops in the wizard or past their trial pay for the session lookup.
  const viewer = await currentUser();
  const staff = reason === "setup" ? storefrontAccess(scope.tenant, viewer) === "staff-preview" : viewer?.role === "OWNER" && viewer.tenantId === scope.tenant.id;
  return { prelaunch: true, staff, reason };
});

/**
 * The request's tenant for storefront actions: like getRequestTenant(), but null while the shop is
 * "coming soon" and the viewer is not its staff.
 */
export async function getOpenShopTenant() {
  const scope = await getRequestScope();
  if (scope.kind !== "tenant") return null;
  const launch = await getLaunchState();
  if (launch.prelaunch && !launch.staff) return null;
  return scope.tenant;
}
