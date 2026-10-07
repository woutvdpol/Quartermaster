/* Date formatting helpers (plain module). Times are shown in the tenant timezone (Tenant.timezone). */
import { DEFAULT_FORMAT_LOCALE } from "./money-utils";

export const DEFAULT_TIME_ZONE = "Europe/Amsterdam";

export type DateInputValue = Date | string | number;

export function toDate(value: DateInputValue): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DateFormat = "date" | "datetime" | "time" | "long";

const presets: Record<DateFormat, Intl.DateTimeFormatOptions> = {
  date: { day: "numeric", month: "short", year: "numeric" },
  datetime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
  time: { hour: "2-digit", minute: "2-digit" },
  long: { dateStyle: "full", timeStyle: "short" },
};

export function formatDate(
  date: Date,
  format: DateFormat = "datetime",
  timeZone: string = DEFAULT_TIME_ZONE,
  locale: string = DEFAULT_FORMAT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, { ...presets[format], timeZone }).format(date);
}

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "3 hours ago", "in 2 days", "now". `now` defaults to the current time. */
export function formatRelative(date: Date, now: Date = new Date(), locale: string = DEFAULT_FORMAT_LOCALE): string {
  const diff = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 45) return rtf.format(0, "second");
  for (const [unit, seconds] of units) {
    if (abs >= seconds || unit === "second") return rtf.format(Math.round(diff / seconds), unit);
  }
  return rtf.format(0, "second");
}

/** Milliseconds between `date` and now (absolute). */
export function ageMs(date: Date, now: Date = new Date()): number {
  return Math.abs(now.getTime() - date.getTime());
}
