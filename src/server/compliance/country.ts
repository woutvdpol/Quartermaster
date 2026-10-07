import { normalizeCountryCode } from "@/server/shipping/countries";

/**
 * Visitor country for geo compliance (pure; pass request headers). Checks, in order, the headers set
 * by the edge in front of the app: `cf-ipcountry` (Cloudflare), `x-vercel-ip-country` (Vercel),
 * `x-country` (own reverse proxy / nginx GeoIP). Returns an ISO-2 code or null when unknown
 * ("XX", Tor "T1", missing or invalid) — callers then apply NO geo rules.
 *
 * NB: these headers are only trustworthy when the proxy overwrites them; a client can send them
 * itself when the app is reached directly. Checkout enforces NO_SHIPPING on the shipping country.
 */
export function visitorCountry(headers: { get(name: string): string | null } | null | undefined): string | null {
  if (!headers) return null;
  for (const name of ["cf-ipcountry", "x-vercel-ip-country", "x-country"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    const code = normalizeCountryCode(raw);
    if (code) return code;
  }
  return null;
}
