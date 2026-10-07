// Date helpers for the coupon form (datetime-local inputs are in the shop's time zone).

/** "2026-10-07T14:30" in `timeZone` → Date (UTC); "" → null. */
export function localInputToDate(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of the zone at that moment: format the guess in the zone and compare.
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

/** Date → "YYYY-MM-DDTHH:mm" in `timeZone` (for datetime-local defaultValue). */
export function dateToLocalInput(date: Date | null, timeZone: string): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
