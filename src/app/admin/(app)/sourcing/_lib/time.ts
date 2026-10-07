/*
 * Small timezone helpers for tenant-local calendar days (plain module, server + client safe).
 * Dates as "YYYY-MM-DD" strings are always tenant-local calendar days.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's calendar date in `timeZone` as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Adds whole days to a YYYY-MM-DD string. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Offset (ms) of `timeZone` from UTC at instant `date`. */
function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight at the start of `ymd` in `timeZone`. */
export function startOfLocalDay(ymd: string, timeZone: string): Date {
  const guess = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  const first = offsetMs(new Date(guess), timeZone);
  let t = guess - first;
  const second = offsetMs(new Date(t), timeZone);
  if (second !== first) t = guess - second;
  return new Date(t);
}

/** A YYYY-MM-DD calendar day as a Date at UTC midnight (format it with timeZone "UTC"). */
export function ymdAsUtcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}
