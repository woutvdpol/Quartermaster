import { zonedParts } from "@/server/alerts/schedule";

/*
 * Push delivery rules (pure; docs/push.md).
 *
 *  - Quiet hours: Customer.pushQuietStart/End = minutes after local midnight in the TENANT time zone.
 *    start > end wraps midnight (22:00–08:00). start == end or either null = no quiet hours.
 *    A push that falls inside them waits until they end (PushMessage.queuedFor) — except
 *    RESERVATION_ENDING, which is useless later and is dropped.
 *  - Daily cap: Customer.pushMaxPerDay pushes per local calendar day. RESERVATION_ENDING doesn't
 *    count and is never capped. Over the cap a push waits for the next local day (after quiet hours).
 *  - One event pushes once: PushMessage (customerId, dedupeKey) is unique; the keys come from here.
 */

export type PushKind = "SAVED_SEARCH" | "BACK_AVAILABLE" | "PRICE_DROP" | "RESERVATION_ENDING";

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** Select options of the account page (minutes after midnight). */
export const QUIET_HOUR_PRESETS = [
  { start: 22 * 60, end: 8 * 60 },
  { start: 23 * 60, end: 7 * 60 },
  { start: 21 * 60, end: 9 * 60 },
  { start: 0, end: 8 * 60 },
] as const;
export const MAX_PER_DAY_OPTIONS = [1, 3, 5, 10, 20] as const;
export const DEFAULT_MAX_PER_DAY = 5;

/** Reservation-ending push: this long before the 15-minute hold lapses. */
export const RESERVATION_WARNING_MS = 3 * MINUTE;
/** …but not when less than this is left (the scan runs every minute; no "0 minutes left"). */
export const RESERVATION_MIN_LEFT_MS = 45_000;

/** Unsent messages older than this are dropped by the flush cron (a "new item" from 2 days ago is stale). */
export const STALE_AFTER_MS = 48 * 60 * MINUTE;

export function localMinuteOfDay(now: Date, timeZone: string): number {
  const p = zonedParts(now, timeZone);
  return p.hour * 60 + p.minute;
}

function validMinute(m: number | null | undefined): m is number {
  return typeof m === "number" && Number.isInteger(m) && m >= 0 && m < DAY_MINUTES;
}

export function hasQuietHours(start: number | null | undefined, end: number | null | undefined): boolean {
  return validMinute(start) && validMinute(end) && start !== end;
}

/** Is `minute` (after local midnight) inside [start, end)? Wraps midnight when start > end. */
export function inQuietHours(minute: number, start: number | null | undefined, end: number | null | undefined): boolean {
  if (!hasQuietHours(start, end)) return false;
  return start! < end! ? minute >= start! && minute < end! : minute >= start! || minute < end!;
}

/** Start of the current minute in ms, minus the seconds already passed in it (for exact minute maths). */
function minuteFloor(now: Date, timeZone: string): number {
  const p = zonedParts(now, timeZone);
  return now.getTime() - (p.second * 1000 + (now.getTime() % 1000));
}

/** When the quiet hours `now` falls in end; null when `now` is not in quiet hours. */
export function quietHoursEnd(now: Date, timeZone: string, start: number | null | undefined, end: number | null | undefined): Date | null {
  const minute = localMinuteOfDay(now, timeZone);
  if (!inQuietHours(minute, start, end)) return null;
  const delta = (end! - minute + DAY_MINUTES) % DAY_MINUTES;
  return new Date(minuteFloor(now, timeZone) + delta * MINUTE);
}

/** Local midnight (start of today) in `timeZone`. DST days are off by the shift at most — fine for a cap. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  return new Date(minuteFloor(now, timeZone) - localMinuteOfDay(now, timeZone) * MINUTE);
}

export type PushDecision =
  | { action: "send" }
  | { action: "defer"; until: Date; reason: "quiet" | "cap" }
  | { action: "drop"; reason: "quiet" };

export type PushDecisionInput = {
  kind: PushKind;
  now: Date;
  timeZone: string;
  quietStart: number | null;
  quietEnd: number | null;
  /** Pushes already sent today (local day), RESERVATION_ENDING excluded. */
  sentToday: number;
  maxPerDay: number;
};

export function decidePush(i: PushDecisionInput): PushDecision {
  const quietUntil = quietHoursEnd(i.now, i.timeZone, i.quietStart, i.quietEnd);
  if (i.kind === "RESERVATION_ENDING") return quietUntil ? { action: "drop", reason: "quiet" } : { action: "send" };
  if (quietUntil) return { action: "defer", until: quietUntil, reason: "quiet" };
  const max = Math.max(1, Math.trunc(i.maxPerDay || DEFAULT_MAX_PER_DAY));
  if (i.sentToday >= max) {
    const tomorrow = new Date(startOfLocalDay(i.now, i.timeZone).getTime() + DAY_MINUTES * MINUTE);
    return { action: "defer", until: quietHoursEnd(tomorrow, i.timeZone, i.quietStart, i.quietEnd) ?? tomorrow, reason: "cap" };
  }
  return { action: "send" };
}

// ─── Dedupe keys (PushMessage.dedupeKey, unique per customer) ───────────────

export const dedupeKeys = {
  /** One push per saved-search delivery (= search × product). */
  savedSearch: (deliveryId: string) => `search:${deliveryId}`,
  /** One push per product per new price. */
  priceDrop: (productId: string, newPrice: number) => `price:${productId}:${newPrice}`,
  /** One push per cart per expiry minute (an extended hold warns again). */
  reservation: (cartId: string, expiresAt: Date) => `reservation:${cartId}:${Math.floor(expiresAt.getTime() / MINUTE)}`,
};

// ─── Payload (what public/sw.js receives) ──────────────────────────────────

export type PushPayload = { title: string; body: string; url: string; tag: string; icon?: string; urgent?: boolean };

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Only same-origin paths: the service worker opens it relative to the shop it runs on. */
export function safePushUrl(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\") ? url.slice(0, 1000) : "/";
}

/** JSON for `event.data.json()` in public/sw.js. Kept small: push services cap payloads at ~4 kB. */
export function buildPushPayload(msg: { id: string; kind: PushKind; title: string; body: string; url: string }, opts: { icon?: string | null } = {}): string {
  const payload: PushPayload = {
    title: clip(msg.title, 120),
    body: clip(msg.body, 240),
    url: safePushUrl(msg.url),
    // Same tag = the newer notification replaces the older one (reservation warnings, one per cart).
    tag: msg.kind === "RESERVATION_ENDING" ? "reservation" : `qm-${msg.id}`,
    ...(opts.icon ? { icon: opts.icon } : {}),
    ...(msg.kind === "RESERVATION_ENDING" ? { urgent: true } : {}),
  };
  return JSON.stringify(payload);
}

/** Web push TTL (seconds): how long the push service keeps trying to reach an offline device. */
export function pushTtlSeconds(kind: PushKind, now: Date, expiresAt?: Date | null): number {
  if (kind === "RESERVATION_ENDING") {
    const left = expiresAt ? Math.floor((expiresAt.getTime() - now.getTime()) / 1000) : 120;
    return Math.max(30, left);
  }
  return kind === "SAVED_SEARCH" ? 6 * 60 * 60 : 24 * 60 * 60;
}
