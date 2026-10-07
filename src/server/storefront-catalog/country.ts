/**
 * Best guess of the visitor's country for the "shipping from" hint: Cloudflare's `cf-ipcountry`,
 * then the region of the first Accept-Language tag that has one, then the fallback (shop country).
 * Pure — pass the header values in.
 */
export function visitorCountry(
  headers: { cfIpCountry?: string | null; acceptLanguage?: string | null },
  fallback = "NL",
): string {
  const cf = headers.cfIpCountry?.trim().toUpperCase();
  if (cf && /^[A-Z]{2}$/.test(cf) && cf !== "XX" && cf !== "T1") return cf;
  for (const part of (headers.acceptLanguage ?? "").split(",").slice(0, 10)) {
    const tag = part.split(";")[0]?.trim();
    const m = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(tag ?? "");
    if (m) return m[1].toUpperCase();
  }
  return fallback;
}
