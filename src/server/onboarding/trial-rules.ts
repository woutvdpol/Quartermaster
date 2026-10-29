/*
 * Free-trial rules (docs/signup-modes.md). Pure, so they are unit-testable and safe to import anywhere.
 *
 * A trial shop has Tenant.trialEndsAt. While it runs the shop works normally (package Compleet); once it
 * has passed, the storefront is closed for visitors and the admin stays open. Tenant.trialNotices counts
 * the owner mails already sent: 1 = one week left, 2 = one day left, 3 = ended.
 */

import type { ApplicationChecks } from "./rules";

const DAY_MS = 24 * 60 * 60 * 1000;

export const TRIAL_DAYS_MIN = 1;
export const TRIAL_DAYS_MAX = 90;
/** Days a superadmin adds with one "Extend trial" click (the form allows another number). */
export const TRIAL_EXTEND_DEFAULT_DAYS = 14;
/** Trials started automatically per 24 h (all applicants together); beyond it they wait for review. */
export const TRIAL_DAILY_CAP = 25;

export const TRIAL_NOTICE = { week: 1, day: 2, ended: 3 } as const;
export type TrialNotice = (typeof TRIAL_NOTICE)[keyof typeof TRIAL_NOTICE];

export type TrialState =
  | { kind: "none" }
  | { kind: "running"; endsAt: Date; daysLeft: number }
  | { kind: "ended"; endsAt: Date };

/** Whole days left, rounded up (23 h 59 min = 1 day). */
export function trialDaysLeft(endsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS));
}

export function trialState(tenant: { trialEndsAt: Date | null | undefined }, now: Date = new Date()): TrialState {
  const endsAt = tenant.trialEndsAt;
  if (!endsAt) return { kind: "none" };
  if (endsAt.getTime() <= now.getTime()) return { kind: "ended", endsAt };
  return { kind: "running", endsAt, daysLeft: trialDaysLeft(endsAt, now) };
}

export function isTrialEnded(tenant: { trialEndsAt: Date | null | undefined }, now: Date = new Date()): boolean {
  return trialState(tenant, now).kind === "ended";
}

export function trialEndFrom(start: Date, days: number): Date {
  return new Date(start.getTime() + days * DAY_MS);
}

/** New end date when a superadmin extends: counted from now when the trial has already ended. */
export function extendedTrialEnd(endsAt: Date, days: number, now: Date): Date {
  return trialEndFrom(endsAt.getTime() > now.getTime() ? endsAt : now, days);
}

/**
 * The owner mail that is due now, or null. Only the most urgent one: a trial that is already within a
 * day (or over) skips the week reminder.
 */
export function dueTrialNotice(endsAt: Date, sent: number, now: Date): TrialNotice | null {
  const left = endsAt.getTime() - now.getTime();
  const due: TrialNotice | null = left <= 0 ? TRIAL_NOTICE.ended : left <= DAY_MS ? TRIAL_NOTICE.day : left <= 7 * DAY_MS ? TRIAL_NOTICE.week : null;
  return due !== null && due > sent ? due : null;
}

/**
 * Why a trial application is not turned into a shop automatically (empty = go ahead). It then waits
 * for a superadmin like a normal application; the reasons go into its internal note.
 */
export function autoTrialBlockers(checks: ApplicationChecks, extra: { cocUsedBefore: boolean; dailyCapReached: boolean }): string[] {
  const out: string[] = [];
  if (checks.duplicateEmail) out.push("email address already known");
  if (checks.disposableEmail) out.push("disposable email domain");
  if (checks.duplicateShopName) out.push("similar shop name exists");
  if (checks.cocFormat === "invalid") out.push("CoC number format invalid");
  if (extra.cocUsedBefore) out.push("CoC number used in another application");
  if (extra.dailyCapReached) out.push(`more than ${TRIAL_DAILY_CAP} trials started in 24 hours`);
  return out;
}
