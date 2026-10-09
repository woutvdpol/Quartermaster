import { productHref } from "@/server/storefront-catalog/urls";

/*
 * Quartermaster network (docs/network.md): where it is served and the absolute links into dealer shops.
 * Pure — used by src/proxy.ts (no DB there), the network pages and unit tests.
 *
 * Mount:
 *  - NETWORK_HOST unset → the platform host (PLATFORM_HOST) serves the network at /network.
 *  - NETWORK_HOST set   → that host serves the network at "/" (the proxy rewrites /x → /network/x);
 *                         PLATFORM_HOST/network redirects there.
 */

export const NETWORK_PATH = "/network";

export type NetworkHosts = { platformHost: string | null; networkHost: string | null };

function normalize(host: string | null | undefined): string | null {
  return host?.trim().toLowerCase().replace(/\.$/, "") || null;
}

export function readNetworkHosts(env: Record<string, string | undefined> = process.env): NetworkHosts {
  return { platformHost: normalize(env.PLATFORM_HOST), networkHost: normalize(env.NETWORK_HOST) };
}

export type NetworkMount =
  /** Serve the network here; `base` is the path prefix for its links ("" on NETWORK_HOST). */
  | { kind: "serve"; base: "" | typeof NETWORK_PATH; origin: string }
  /** Platform host while NETWORK_HOST is set: send visitors to the network host. */
  | { kind: "redirect"; origin: string }
  | { kind: "none" };

/** Is this host served over plain http (local development)? Mirrors src/server/storefront/context.ts. */
export function isLocalDevHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name.endsWith(".localhost") || name.endsWith(".test");
}

/** Absolute origin of a host: http for local dev hosts, otherwise https (like originForHost). */
export function originOf(host: string): string {
  return `${isLocalDevHost(host) ? "http" : "https"}://${host}`;
}

/** How the request host relates to the network. Unknown hosts (shops included) never serve it. */
export function networkMount(requestHost: string | null | undefined, hosts: NetworkHosts = readNetworkHosts()): NetworkMount {
  const host = normalize(requestHost);
  if (!host) return { kind: "none" };
  if (hosts.networkHost && host === hosts.networkHost) return { kind: "serve", base: "", origin: originOf(host) };
  if (hosts.platformHost && host === hosts.platformHost) {
    return hosts.networkHost ? { kind: "redirect", origin: originOf(hosts.networkHost) } : { kind: "serve", base: NETWORK_PATH, origin: originOf(host) };
  }
  return { kind: "none" };
}

/** A network link under the mount base: networkHref("/network", "/dealers") → "/network/dealers". */
export function networkHref(base: string, path: string = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (p === "/") return base || "/";
  return `${base}${p}`;
}

/** Paths on NETWORK_HOST that are not network pages (assets, APIs, crawler files). */
const NETWORK_HOST_PASSTHROUGH = /^\/(?:api\/|_next\/|uploads\/|fonts\/|network(?:\/|$)|[^/]+\.(?:txt|xml|ico|webmanifest|js|json|png|svg)$)/;

/** Proxy rewrite on NETWORK_HOST: "/" → "/network", "/dealers" → "/network/dealers"; null = leave as is. */
export function networkRewritePath(pathname: string): string | null {
  if (NETWORK_HOST_PASSTHROUGH.test(pathname)) return null;
  return pathname === "/" ? NETWORK_PATH : `${NETWORK_PATH}${pathname}`;
}

/** Absolute product URL in the dealer's own shop: https://<primary domain>/product/<stockCode>/<slug>. */
export function dealerProductUrl(primaryHost: string, product: { stockCode: number; slug: string }): string {
  return `${originOf(primaryHost)}${productHref(product)}`;
}

/** The dealer's shop home page. */
export function dealerShopUrl(primaryHost: string): string {
  return `${originOf(primaryHost)}/`;
}

/**
 * PLATFORM_HOST/network/x while NETWORK_HOST is set → the absolute URL on NETWORK_HOST (permanent redirect
 * in the proxy); null otherwise.
 */
export function platformNetworkRedirect(requestHost: string | null | undefined, pathname: string, hosts: NetworkHosts = readNetworkHosts()): string | null {
  if (!hosts.networkHost || !hosts.platformHost || normalize(requestHost) !== hosts.platformHost) return null;
  if (pathname !== NETWORK_PATH && !pathname.startsWith(`${NETWORK_PATH}/`)) return null;
  return `${originOf(hosts.networkHost)}${pathname.slice(NETWORK_PATH.length) || "/"}`;
}

/** The dealer application page (/apply on the platform host), relative when the network runs there. */
export function platformApplyUrl(base: string, hosts: NetworkHosts = readNetworkHosts()): string {
  if (base === NETWORK_PATH || !hosts.platformHost) return "/apply";
  return `${originOf(hosts.platformHost)}/apply`;
}
