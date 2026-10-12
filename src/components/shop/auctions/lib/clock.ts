/*
 * Server-clock sync for auction countdowns (docs/auctions-plan.md § Live verversen). Pure.
 *
 * Every stream message and poll response carries the server time. The device clock is never trusted:
 * countdowns use `now + offset`, where offset = serverTime − localTime at receipt. A message that was
 * delayed in transit makes its sample too small (the server time is older than "now"), so the largest
 * recent sample is the best estimate. A sample far from the current estimate means the device clock
 * jumped (manual change, sleep/NTP correction): start over from that sample.
 */

const WINDOW = 8;
const JUMP_MS = 5_000;

export type OffsetTracker = { samples: number[]; offset: number };

export const EMPTY_TRACKER: OffsetTracker = { samples: [], offset: 0 };

/**
 * One offset sample. `receivedAt` = local ms when the message arrived; for a request/response pair
 * pass `sentAt` too and the round-trip midpoint is used.
 */
export function offsetSample(serverTime: string | number, receivedAt: number, sentAt?: number): number | null {
  const server = typeof serverTime === "number" ? serverTime : Date.parse(serverTime);
  if (!Number.isFinite(server)) return null;
  const local = sentAt !== undefined && sentAt <= receivedAt ? (sentAt + receivedAt) / 2 : receivedAt;
  return Math.round(server - local);
}

/** Adds a sample; returns the new tracker (offset = max of the recent window). */
export function addOffsetSample(tracker: OffsetTracker, sample: number | null): OffsetTracker {
  if (sample === null) return tracker;
  const jumped = tracker.samples.length > 0 && Math.abs(sample - tracker.offset) > JUMP_MS;
  const samples = jumped ? [sample] : [...tracker.samples, sample].slice(-WINDOW);
  return { samples, offset: Math.max(...samples) };
}

/** Milliseconds until `closesAt` on the server clock (negative once passed). */
export function remainingMs(closesAt: string | number, localNow: number, offset: number): number {
  const end = typeof closesAt === "number" ? closesAt : Date.parse(closesAt);
  return end - (localNow + offset);
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number; done: boolean };

export function countdownParts(ms: number): CountdownParts {
  if (!(ms > 0)) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  // Round up: "00:01" is shown until the last second has fully passed.
  const total = Math.ceil(ms / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    done: false,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Clock text: "06:12" under an hour, "01:42:18" under a day, "2d 04:12" beyond (day suffix per
 * language: `dayUnit`). Done → "00:00".
 */
export function formatCountdown(ms: number, dayUnit = "d"): string {
  const p = countdownParts(ms);
  if (p.done) return "00:00";
  if (p.days > 0) return `${p.days}${dayUnit} ${pad(p.hours)}:${pad(p.minutes)}`;
  if (p.hours > 0) return `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
  return `${pad(p.minutes)}:${pad(p.seconds)}`;
}

/** Visual urgency of a countdown: under 2 minutes "final" (extension window), under 10 "soon". */
export function countdownUrgency(ms: number): "done" | "final" | "soon" | "normal" {
  if (!(ms > 0)) return "done";
  if (ms <= 120_000) return "final";
  if (ms <= 600_000) return "soon";
  return "normal";
}
