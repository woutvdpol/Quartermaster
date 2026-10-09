import { describe, expect, it } from "vitest";
import { pushCopy } from "./copy";
import {
  buildPushPayload,
  decidePush,
  dedupeKeys,
  hasQuietHours,
  inQuietHours,
  quietHoursEnd,
  safePushUrl,
  startOfLocalDay,
  type PushDecisionInput,
} from "./rules";

const AMS = "Europe/Amsterdam"; // UTC+2 in October (until the 25th), UTC+1 in winter
const H = 60;

describe("quiet hours", () => {
  it("handles windows across midnight and within a day", () => {
    expect(inQuietHours(23 * H, 22 * H, 8 * H)).toBe(true);
    expect(inQuietHours(3 * H, 22 * H, 8 * H)).toBe(true);
    expect(inQuietHours(8 * H, 22 * H, 8 * H)).toBe(false); // end is exclusive
    expect(inQuietHours(12 * H, 22 * H, 8 * H)).toBe(false);
    expect(inQuietHours(22 * H, 22 * H, 8 * H)).toBe(true); // start is inclusive
    expect(inQuietHours(5 * H, 0, 8 * H)).toBe(true);
    expect(inQuietHours(9 * H, 0, 8 * H)).toBe(false);
  });

  it("is off when unset, equal or invalid", () => {
    expect(hasQuietHours(null, 8 * H)).toBe(false);
    expect(hasQuietHours(8 * H, 8 * H)).toBe(false);
    expect(hasQuietHours(-1, 8 * H)).toBe(false);
    expect(hasQuietHours(22 * H, 24 * H)).toBe(false);
    expect(inQuietHours(3 * H, null, null)).toBe(false);
  });

  it("computes when quiet hours end in the tenant time zone", () => {
    // 23:30 local (21:30Z) → ends 08:00 local next day = 06:00Z.
    expect(quietHoursEnd(new Date("2026-10-09T21:30:20Z"), AMS, 22 * H, 8 * H)?.toISOString()).toBe("2026-10-10T06:00:00.000Z");
    // 03:00 local → 08:00 local the same day.
    expect(quietHoursEnd(new Date("2026-10-10T01:00:00Z"), AMS, 22 * H, 8 * H)?.toISOString()).toBe("2026-10-10T06:00:00.000Z");
    // Winter time (UTC+1).
    expect(quietHoursEnd(new Date("2026-12-01T23:00:00Z"), AMS, 22 * H, 8 * H)?.toISOString()).toBe("2026-12-02T07:00:00.000Z");
    expect(quietHoursEnd(new Date("2026-10-09T10:00:00Z"), AMS, 22 * H, 8 * H)).toBeNull();
  });

  it("start of the local day", () => {
    expect(startOfLocalDay(new Date("2026-10-09T10:15:42.123Z"), AMS).toISOString()).toBe("2026-10-08T22:00:00.000Z");
    expect(startOfLocalDay(new Date("2026-10-09T23:15:00Z"), AMS).toISOString()).toBe("2026-10-09T22:00:00.000Z");
  });
});

describe("decidePush", () => {
  const base: PushDecisionInput = {
    kind: "SAVED_SEARCH",
    now: new Date("2026-10-09T10:00:00Z"), // 12:00 local
    timeZone: AMS,
    quietStart: 22 * H,
    quietEnd: 8 * H,
    sentToday: 0,
    maxPerDay: 5,
  };

  it("sends outside quiet hours and under the cap", () => {
    expect(decidePush(base)).toEqual({ action: "send" });
    expect(decidePush({ ...base, sentToday: 4 })).toEqual({ action: "send" });
  });

  it("defers to the end of quiet hours", () => {
    const night = new Date("2026-10-09T21:00:00Z"); // 23:00 local
    expect(decidePush({ ...base, now: night })).toEqual({ action: "defer", until: new Date("2026-10-10T06:00:00Z"), reason: "quiet" });
    expect(decidePush({ ...base, kind: "PRICE_DROP", now: night }).action).toBe("defer");
  });

  it("drops a reservation warning in quiet hours and never caps it", () => {
    const night = new Date("2026-10-09T21:00:00Z");
    expect(decidePush({ ...base, kind: "RESERVATION_ENDING", now: night })).toEqual({ action: "drop", reason: "quiet" });
    expect(decidePush({ ...base, kind: "RESERVATION_ENDING", sentToday: 99, maxPerDay: 1 })).toEqual({ action: "send" });
  });

  it("over the daily cap waits for the next day, after quiet hours", () => {
    expect(decidePush({ ...base, sentToday: 5 })).toEqual({ action: "defer", until: new Date("2026-10-10T06:00:00Z"), reason: "cap" });
    expect(decidePush({ ...base, sentToday: 5, quietStart: null, quietEnd: null })).toEqual({
      action: "defer",
      until: new Date("2026-10-09T22:00:00Z"), // local midnight
      reason: "cap",
    });
  });

  it("treats a broken cap as the default", () => {
    expect(decidePush({ ...base, sentToday: 4, maxPerDay: 0 }).action).toBe("send");
    expect(decidePush({ ...base, sentToday: 5, maxPerDay: 0 }).action).toBe("defer");
  });
});

describe("dedupe keys", () => {
  it("are stable per event", () => {
    expect(dedupeKeys.savedSearch("d1")).toBe("search:d1");
    expect(dedupeKeys.priceDrop("p1", 109000)).toBe("price:p1:109000");
    const a = dedupeKeys.reservation("c1", new Date("2026-10-09T10:15:10Z"));
    expect(a).toBe(dedupeKeys.reservation("c1", new Date("2026-10-09T10:15:50Z")));
    expect(a).not.toBe(dedupeKeys.reservation("c1", new Date("2026-10-09T10:30:10Z"))); // extended hold warns again
  });
});

describe("payload", () => {
  it("builds a small JSON payload for the service worker", () => {
    const json = JSON.parse(
      buildPushPayload({ id: "m1", kind: "SAVED_SEARCH", title: "New:  Stahlhelm\nM40", body: "x".repeat(400), url: "/product/12/helm" }, { icon: "/pwa-icon/192" }),
    );
    expect(json).toEqual({ title: "New: Stahlhelm M40", body: `${"x".repeat(239)}…`, url: "/product/12/helm", tag: "qm-m1", icon: "/pwa-icon/192" });
  });

  it("marks reservation warnings urgent with one shared tag", () => {
    const json = JSON.parse(buildPushPayload({ id: "m2", kind: "RESERVATION_ENDING", title: "t", body: "b", url: "/cart" }));
    expect(json).toMatchObject({ tag: "reservation", urgent: true, url: "/cart" });
  });

  it("only allows same-origin paths", () => {
    expect(safePushUrl("https://evil.example/x")).toBe("/");
    expect(safePushUrl("//evil.example/x")).toBe("/");
    expect(safePushUrl("/\\evil.example")).toBe("/");
    expect(safePushUrl("/cart")).toBe("/cart");
  });

  it("copy", () => {
    expect(pushCopy.newMatch({ title: "Stahlhelm M40", price: 145000, currency: "EUR", searchName: "M40 helmets" }).title).toBe("New: Stahlhelm M40 — €1,450.00");
    expect(pushCopy.priceDrop({ title: "Feldbluse M36", oldPrice: 119000, newPrice: 109000, currency: "EUR" }).body).toBe(
      "Feldbluse M36 is now €1,090.00 (was €1,190.00).",
    );
    expect(pushCopy.reservationEnding({ items: 1, minutesLeft: 3 }).body).toBe("The item in your cart is held for 3 more minutes. Check out to keep it.");
    expect(pushCopy.reservationEnding({ items: 2, minutesLeft: 1 }).body).toBe("The 2 items in your cart are held for about a minute. Check out to keep them.");
  });
});
