/**
 * Digest timing (pure). DAILY digests go out at 07:00 in the tenant's time zone, WEEKLY ones on
 * Mondays at 07:00. The `alerts.digest` cron runs hourly; for each saved search it computes the most
 * recent slot ≤ now and sends when the search was not notified since that slot. A digest only
 * contains deliveries created BEFORE the slot, so an item found at 10:00 waits for tomorrow's 07:00
 * mail instead of triggering an extra one. Missed runs catch up on the next tick.
 */

export const DIGEST_HOUR = 7;

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAYS[map.weekday] ?? 0,
  };
}

/** Offset (ms) of `timeZone` from UTC at `date`. */
function offsetAt(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of a local wall-clock time in `timeZone`. */
export function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  let t = guess - offsetAt(new Date(guess), timeZone);
  t = guess - offsetAt(new Date(t), timeZone); // second pass settles DST transitions
  return new Date(t);
}

/** Most recent digest slot ≤ now for the frequency, or null for INSTANT. */
export function lastDigestSlot(frequency: "INSTANT" | "DAILY" | "WEEKLY", now: Date, timeZone: string): Date | null {
  if (frequency === "INSTANT") return null;
  const p = zonedParts(now, timeZone);
  // Walk back day by day (max 8) from today's local date to the first eligible slot ≤ now.
  for (let back = 0; back <= 8; back++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
    const weekday = d.getUTCDay();
    if (frequency === "WEEKLY" && weekday !== 1) continue;
    const slot = zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), DIGEST_HOUR, timeZone);
    if (slot.getTime() <= now.getTime()) return slot;
  }
  return null;
}

/** Whether a digest for this search is due now (see top). */
export function digestSlotDue(
  frequency: "INSTANT" | "DAILY" | "WEEKLY",
  now: Date,
  timeZone: string,
  lastNotifiedAt: Date | null,
): Date | null {
  const slot = lastDigestSlot(frequency, now, timeZone);
  if (!slot) return null;
  if (lastNotifiedAt && lastNotifiedAt.getTime() >= slot.getTime()) return null;
  return slot;
}
