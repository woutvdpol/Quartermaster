import "server-only";
import { headers } from "next/headers";
import { getRequestScope, normalizeHost } from "@/server/tenant";
import { readNetworkHosts } from "@/lib/network";
import { getShopContext, originForHost, type ShopContext } from "@/server/storefront/context";
import { getLaunchState } from "@/server/storefront/launch";

/*
 * Shared plumbing for the SEO route handlers (sitemaps, feed, llms.txt, markdown alternates).
 * Resolution is by request host, exactly like the storefront: a shop host serves its own data only.
 */

export type SeoScope = { kind: "shop"; shop: ShopContext } | { kind: "platform"; origin: string } | { kind: "network"; origin: string } | { kind: "closed" } | { kind: "none" };

/**
 * Which machine-readable content this host may serve:
 *  - "shop":     a live tenant shop
 *  - "closed":   a tenant shop that is "coming soon" (nothing is published, staff included)
 *  - "platform": the platform host
 *  - "network":  NETWORK_HOST, the Quartermaster network on its own host (docs/network.md)
 *  - "none":     unknown host
 */
export async function getSeoScope(): Promise<SeoScope> {
  const scope = await getRequestScope();
  if (scope.kind === "platform") {
    const h = await headers();
    return { kind: "platform", origin: originForHost(h.get("host") ?? "", h.get("x-forwarded-proto")) };
  }
  if (scope.kind !== "tenant") {
    const h = await headers();
    const host = normalizeHost(h.get("host"));
    const network = readNetworkHosts().networkHost;
    return network && host === network ? { kind: "network", origin: originForHost(host, h.get("x-forwarded-proto")) } : { kind: "none" };
  }
  if ((await getLaunchState()).prelaunch) return { kind: "closed" };
  const shop = await getShopContext();
  return shop ? { kind: "shop", shop } : { kind: "none" };
}

/**
 * Shared-cache lifetime for generated SEO files. Short: items are unique and a sold item must
 * leave the feed quickly; the data cache behind it is invalidated immediately on every change.
 */
const CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

export function textResponse(body: string, contentType: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: { "Content-Type": `${contentType}; charset=utf-8`, "Cache-Control": CACHE_CONTROL, "X-Content-Type-Options": "nosniff", ...extra },
  });
}

export function notFoundResponse(): Response {
  return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
