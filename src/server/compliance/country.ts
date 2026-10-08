import { countryForIp } from "@/server/geo/ip-country";
import { clientIpFromHeaders } from "@/server/request-meta";
import { normalizeCountryCode } from "@/server/shipping/countries";

/**
 * Visitor country for geo compliance (pure; pass request headers). Checks, in order, the headers set
 * by the edge in front of the app: `cf-ipcountry` (Cloudflare), `x-vercel-ip-country` (Vercel),
 * `x-country` (own reverse proxy / nginx GeoIP); without one of those, the client IP (trusted proxy
 * chain, TRUSTED_PROXY_HOPS) in the local IP-country database (src/server/geo/ip-country.ts).
 * Returns an ISO-2 code or null when unknown ("XX", Tor "T1", missing or invalid) — callers then
 * apply NO geo rules.
 *
 * NB: these headers are only trustworthy when the proxy overwrites them; a client can send them
 * itself when the app is reached directly. Checkout enforces NO_SHIPPING on the shipping country.
 */
export function visitorCountry(headers: Pick<Headers, "get"> | null | undefined): string | null {
  if (!headers) return null;
  for (const name of ["cf-ipcountry", "x-vercel-ip-country", "x-country"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    const code = normalizeCountryCode(raw);
    if (code) return code;
  }
  return countryForIp(clientIpFromHeaders(headers));
}

/**
 * visitorCountry() for the current request via next/headers; null outside a request scope (scripts,
 * worker, tests). Used as a default (checkout/cart country), never as a hard rule.
 */
export async function requestVisitorCountry(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return visitorCountry(await headers());
  } catch {
    return null;
  }
}
