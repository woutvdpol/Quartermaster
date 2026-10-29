/*
 * The platform landing (PLATFORM_HOST "/") has its own route, src/app/(shop)/%5Flanding (URL "/_landing"),
 * so its client components never end up in the JS of the shop home page that shares "/" on shop hosts.
 * src/proxy.ts rewrites the platform host's "/" to it. Pure: the proxy has no DB access.
 */

export const PLATFORM_LANDING_PATH = "/_landing";

function normalize(host: string | null | undefined): string | null {
  return host?.trim().toLowerCase().replace(/\.$/, "") || null;
}

/** Internal path to serve instead of `pathname`, or null when this is not the platform host's "/". */
export function platformLandingRewrite(requestHost: string | null | undefined, pathname: string, platformHost: string | null | undefined = process.env.PLATFORM_HOST): string | null {
  const host = normalize(requestHost);
  return pathname === "/" && host !== null && host === normalize(platformHost) ? PLATFORM_LANDING_PATH : null;
}
