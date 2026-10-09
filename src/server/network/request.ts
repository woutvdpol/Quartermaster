import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { visitorCountry } from "@/server/compliance/country";
import { originForHost } from "@/server/storefront/context";
import { normalizeHost } from "@/server/tenant";
import { NETWORK_PATH, networkMount, readNetworkHosts } from "@/lib/network";

/*
 * Request side of the network pages: where the network is mounted for this host (src/lib/network.ts).
 * Shop hosts and unknown hosts 404; the platform host redirects to NETWORK_HOST when that is set.
 */

export type NetworkRequest = {
  /** Link prefix: "/network" on the platform host, "" on NETWORK_HOST. */
  base: "" | typeof NETWORK_PATH;
  /** Absolute origin of this host (canonical URLs, JSON-LD, sitemap). */
  origin: string;
  /** ISO-2 visitor country (compliance + "ships to"), or null when unknown. */
  country: string | null;
};

/** Is this request for NETWORK_HOST? (The shop layout renders network pages there unwrapped.) */
export async function isNetworkHostRequest(): Promise<boolean> {
  const { networkHost } = readNetworkHosts();
  return !!networkHost && normalizeHost((await headers()).get("host")) === networkHost;
}

export const requireNetworkRequest = cache(async (path: string = "/"): Promise<NetworkRequest> => {
  const h = await headers();
  const host = normalizeHost(h.get("host"));
  const mount = networkMount(host);
  if (mount.kind === "redirect") permanentRedirect(`${mount.origin}${path}`);
  if (mount.kind === "none" || !host) notFound();
  return { base: mount.base, origin: originForHost(host, h.get("x-forwarded-proto")), country: visitorCountry(h) };
});
