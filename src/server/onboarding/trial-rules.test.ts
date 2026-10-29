import { describe, expect, it } from "vitest";
import { autoTrialBlockers, dueTrialNotice, extendedTrialEnd, trialDaysLeft, trialState, TRIAL_NOTICE } from "./trial-rules";
import type { ApplicationChecks } from "./rules";

const NOW = new Date("2026-10-29T12:00:00Z");
const H = 60 * 60 * 1000;
const at = (hours: number) => new Date(NOW.getTime() + hours * H);

describe("trialState", () => {
  it("is none without an end date, running before it and ended from it on", () => {
    expect(trialState({ trialEndsAt: null }, NOW)).toEqual({ kind: "none" });
    expect(trialState({ trialEndsAt: at(30 * 24) }, NOW)).toEqual({ kind: "running", endsAt: at(30 * 24), daysLeft: 30 });
    expect(trialState({ trialEndsAt: at(1) }, NOW)).toMatchObject({ kind: "running", daysLeft: 1 });
    expect(trialState({ trialEndsAt: NOW }, NOW)).toEqual({ kind: "ended", endsAt: NOW });
  });

  it("rounds days left up", () => {
    expect(trialDaysLeft(at(24 * 6 + 1), NOW)).toBe(7);
    expect(trialDaysLeft(at(-5), NOW)).toBe(0);
  });
});

describe("dueTrialNotice", () => {
  it("sends the week, day and ended mails once each", () => {
    expect(dueTrialNotice(at(8 * 24), 0, NOW)).toBeNull();
    expect(dueTrialNotice(at(7 * 24), 0, NOW)).toBe(TRIAL_NOTICE.week);
    expect(dueTrialNotice(at(7 * 24), TRIAL_NOTICE.week, NOW)).toBeNull();
    expect(dueTrialNotice(at(20), TRIAL_NOTICE.week, NOW)).toBe(TRIAL_NOTICE.day);
    expect(dueTrialNotice(at(0), TRIAL_NOTICE.day, NOW)).toBe(TRIAL_NOTICE.ended);
    expect(dueTrialNotice(at(-1), TRIAL_NOTICE.ended, NOW)).toBeNull();
  });

  it("skips reminders that are no longer useful", () => {
    expect(dueTrialNotice(at(5), 0, NOW)).toBe(TRIAL_NOTICE.day);
    expect(dueTrialNotice(at(-48), 0, NOW)).toBe(TRIAL_NOTICE.ended);
  });
});

describe("extendedTrialEnd", () => {
  it("adds to a running trial and counts from now for an ended one", () => {
    expect(extendedTrialEnd(at(24), 14, NOW)).toEqual(at(15 * 24));
    expect(extendedTrialEnd(at(-72), 14, NOW)).toEqual(at(14 * 24));
  });
});

describe("autoTrialBlockers", () => {
  const clean: ApplicationChecks = {
    emailVerified: true,
    cocFormat: "ok",
    duplicateEmail: false,
    duplicateShopName: false,
    disposableEmail: false,
    checkedAt: NOW.toISOString(),
  };

  it("lets a clean application through", () => {
    expect(autoTrialBlockers(clean, { cocUsedBefore: false, dailyCapReached: false })).toEqual([]);
    expect(autoTrialBlockers({ ...clean, cocFormat: "missing" }, { cocUsedBefore: false, dailyCapReached: false })).toEqual([]);
  });

  it("holds suspicious applications for review", () => {
    const blockers = autoTrialBlockers(
      { ...clean, duplicateEmail: true, disposableEmail: true, duplicateShopName: true, cocFormat: "invalid" },
      { cocUsedBefore: true, dailyCapReached: true },
    );
    expect(blockers).toHaveLength(6);
  });
});
