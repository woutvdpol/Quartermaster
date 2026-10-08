import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Reader, type Response } from "mmdb-lib";

/*
 * IP → country (ISO-2) from a local database, for visitors not behind an edge that already sets a
 * country header (Cloudflare `cf-ipcountry`, Vercel, own nginx `x-country`). Used for the shipping
 * hint and geo compliance; see docs/geo.md.
 *
 * Data: @ip-location-db/geo-whois-asn-country-mmdb (CC0; built from RIR/WHOIS + NRO statistics,
 * CC BY 4.0 nro.net — used server-side only, never redistributed). Country-level accuracy is good for
 * consumer ISPs; VPNs and mobile roaming report the exit country. Lookups are in-process (~µs): the
 * visitor's IP never leaves the server. Updates arrive with the npm package (Renovate/Dependabot).
 *
 * Env: GEOIP=off disables lookups; GEOIP_DB points at another MaxMind-format (mmdb) country file.
 */

/** ip-location-db files use a flat `country_code`; MaxMind/DB-IP files nest it under `country`. */
type CountryRecord = { country_code?: string; country?: { iso_code?: string } };

const DEFAULT_DB = join(process.cwd(), "node_modules/@ip-location-db/geo-whois-asn-country-mmdb/geo-whois-asn-country.mmdb");

let reader: Reader<Response> | null | undefined;

function getReader(): Reader<Response> | null {
  if (reader !== undefined) return reader;
  if (process.env.GEOIP?.trim().toLowerCase() === "off") return (reader = null);
  const file = process.env.GEOIP_DB?.trim() || DEFAULT_DB;
  try {
    reader = new Reader<Response>(readFileSync(file));
  } catch (e) {
    console.warn(`[geo] IP country database unavailable (${file}): ${(e as Error).message}. Falling back to headers / Accept-Language.`);
    reader = null;
  }
  return reader;
}

/** ISO-2 country for a canonical IP literal (see normalizeIp), or null when unknown / private / disabled. */
export function countryForIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const db = getReader();
  if (!db) return null;
  try {
    const rec = db.get(ip) as CountryRecord | null;
    const code = (rec?.country_code ?? rec?.country?.iso_code)?.toUpperCase();
    return code && /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** Test hook: forget the loaded database (env changes between tests). */
export function resetIpCountryForTests(): void {
  reader = undefined;
}
