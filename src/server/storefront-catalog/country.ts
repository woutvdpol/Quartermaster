import { visitorCountry as geoCountry } from "@/server/compliance/country";

/**
 * Best guess of the visitor's country for the "shipping from" hint: the edge country header or the
 * client IP in the local IP-country database (see compliance/country.ts), then the region of the
 * first Accept-Language tag that has one, then the fallback (shop country).
 */
export function visitorCountry(headers: Pick<Headers, "get">, fallback = "NL"): string {
  const geo = geoCountry(headers);
  if (geo) return geo;
  for (const part of (headers.get("accept-language") ?? "").split(",").slice(0, 10)) {
    const tag = part.split(";")[0]?.trim();
    const m = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(tag ?? "");
    if (m) return m[1].toUpperCase();
  }
  return fallback;
}
