/**
 * Newsletter quota (settings `platform.newsletterQuota`, SUPERADMIN-managed): the number of campaign
 * mails a tenant may send per calendar month in the tenant's time zone; -1 = unlimited.
 *
 * Usage is *derived*, never decremented (unlike legacy `emailer_quota`): the sum of
 * `recipientCount` over the tenant's campaigns whose `sentAt` falls in the current month.
 * `recipientCount` is fixed when sending starts and lowered for recipients that unsubscribed before
 * their batch ran, so failed deliveries still count (they were attempted). Test sends and
 * double-opt-in/transactional mails do not count.
 *
 * Purchased credits (TenantPlan.newsletterCredits, docs/modules.md) top up a campaign that does not fit
 * the remaining monthly quota. The part paid from credits is stored on the campaign (`creditsUsed`)
 * and does not count towards the monthly quota.
 */
export type QuotaCheck =
  | { ok: true; unlimited: boolean; quota: number; used: number; remaining: number | null; fromCredits: number }
  | { ok: false; quota: number; used: number; remaining: number; needed: number; credits: number };

export function checkQuota(input: { quota: number; used: number; needed: number; credits?: number }): QuotaCheck {
  const { quota, used, needed } = input;
  const credits = Math.max(0, input.credits ?? 0);
  if (quota === -1) return { ok: true, unlimited: true, quota, used, remaining: null, fromCredits: 0 };
  const remaining = Math.max(0, quota - used);
  if (needed <= remaining) return { ok: true, unlimited: false, quota, used, remaining: remaining - needed, fromCredits: 0 };
  const fromCredits = needed - remaining;
  if (fromCredits > credits) return { ok: false, quota, used, remaining, needed, credits };
  return { ok: true, unlimited: false, quota, used, remaining: 0, fromCredits };
}

/** Offset of `timeZone` from UTC at `date`, in ms (positive east of UTC). */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Start of the given local month (00:00 on the 1st in `timeZone`) as a UTC instant. */
function localMonthStart(year: number, monthIndex: number, timeZone: string): Date {
  const guess = Date.UTC(year, monthIndex, 1);
  let start = guess - timeZoneOffsetMs(new Date(guess), timeZone);
  // Re-evaluate once in case the offset differs at the actual instant (DST edge).
  start = guess - timeZoneOffsetMs(new Date(start), timeZone);
  return new Date(start);
}

/** [start, end) of the calendar month containing `now`, in `timeZone`. */
export function monthWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const local = new Date(now.getTime() + timeZoneOffsetMs(now, timeZone));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return { start: localMonthStart(y, m, timeZone), end: localMonthStart(m === 11 ? y + 1 : y, (m + 1) % 12, timeZone) };
}
