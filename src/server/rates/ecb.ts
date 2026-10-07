/*
 * ECB euro foreign exchange reference rates. Pure (no server imports): parser + cross-rate math.
 * Source: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml (no key; published around
 * 16:00 CET on TARGET working days). Rates are "units of currency per 1 EUR".
 */

export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export type EcbDaily = {
  /** Reference date, "YYYY-MM-DD". */
  date: string;
  /** Quote currency → units per 1 EUR. EUR itself is not listed. */
  rates: Record<string, number>;
};

/**
 * Parses the ECB daily XML. Tolerant of attribute quote style and order; throws on anything that
 * doesn't look like a valid daily file (no date, no rates) so a bad response never overwrites rates.
 */
export function parseEcbDaily(xml: string): EcbDaily {
  const dateMatch = /<Cube\s+time\s*=\s*["'](\d{4}-\d{2}-\d{2})["']/.exec(xml);
  if (!dateMatch) throw new Error("ECB: no reference date in response");
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const currency = /currency\s*=\s*["']([A-Z]{3})["']/.exec(attrs)?.[1];
    const rateText = /rate\s*=\s*["']([0-9]+(?:\.[0-9]+)?)["']/.exec(attrs)?.[1];
    if (!currency || !rateText) continue;
    const rate = Number(rateText);
    if (Number.isFinite(rate) && rate > 0) rates[currency] = rate;
  }
  if (Object.keys(rates).length === 0) throw new Error("ECB: no rates in response");
  return { date: dateMatch[1], rates };
}

/**
 * Rate from `from` to `to` (units of `to` per 1 unit of `from`) via EUR, given EUR-based rates.
 * Returns null when either currency is unknown.
 */
export function crossRate(eurRates: Record<string, number>, from: string, to: string): number | null {
  const perEur = (c: string) => (c === "EUR" ? 1 : eurRates[c]);
  const f = perEur(from.toUpperCase());
  const t = perEur(to.toUpperCase());
  if (!f || !t || !(f > 0) || !(t > 0)) return null;
  return t / f;
}
