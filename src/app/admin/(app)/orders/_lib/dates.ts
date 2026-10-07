/*
 * Local-day ↔ instant helpers for the order date filter. The URL holds plain days
 * (`from=2026-10-01&to=2026-10-07`, both inclusive) in the shop's time zone; listOrders wants
 * instants (`from` inclusive, `to` exclusive).
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(value: string | undefined): { y: number; m: number; d: number } | null {
  const match = value ? DAY_RE.exec(value) : null;
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Midnight at the start of the given local day in `timeZone`, as an instant. */
export function startOfLocalDay(day: { y: number; m: number; d: number }, timeZone: string): Date {
  const guess = Date.UTC(day.y, day.m - 1, day.d);
  let instant = guess - zoneOffset(guess, timeZone);
  // Second pass corrects for a DST switch between the guess and the result.
  instant = guess - zoneOffset(instant, timeZone);
  return new Date(instant);
}

/** Range for listOrders from the inclusive `from`/`to` day params. Invalid days are ignored. */
export function dayRange(fromParam: string | undefined, toParam: string | undefined, timeZone: string) {
  const from = parseDay(fromParam);
  const to = parseDay(toParam);
  let toNext: Date | undefined;
  if (to) {
    const next = new Date(Date.UTC(to.y, to.m - 1, to.d + 1));
    toNext = startOfLocalDay(
      {
        y: next.getUTCFullYear(),
        m: next.getUTCMonth() + 1,
        d: next.getUTCDate(),
      },
      timeZone,
    );
  }
  return {
    from: from ? startOfLocalDay(from, timeZone) : undefined,
    to: toNext,
  };
}
