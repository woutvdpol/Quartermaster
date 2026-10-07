/* Chart helpers (plain module). */
import { currencyDigits, DEFAULT_FORMAT_LOCALE } from "@/components/admin/ui";

/** "Nice" 0-based scale with 3–5 ticks covering `max`. `floor` is the top used when max is 0. */
export function niceScale(max: number, floor: number): { top: number; ticks: number[] } {
  const target = max > 0 ? max : floor;
  const raw = target / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  const top = Math.max(step, Math.ceil(target / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v));
  return { top, ticks };
}

/** Axis money: "€1.5K", "€800" (minor units in). */
export function compactMoney(minor: number, currency: string, locale: string = DEFAULT_FORMAT_LOCALE): string {
  const major = minor / 10 ** currencyDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: major !== 0 && Math.abs(major) < 1000 ? 0 : 1,
  }).format(major);
}

/**
 * A tenant-local calendar day ("YYYY-MM-DD") as "8 Sep" / "Tue 8 Sep 2026". The string already is
 * the shop's local day, so it is formatted in UTC to avoid shifting it again.
 */
export function dayLabel(ymd: string, long = false, locale: string = DEFAULT_FORMAT_LOCALE): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(long && { weekday: "short", year: "numeric" }),
  }).format(d);
}
