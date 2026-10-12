import { describe, expect, it } from "vitest";
import { auctionLotIdFromDedupeKey, buildPushPayload, decidePush, dedupeKeys, pushTtlSeconds, type PushDecisionInput } from "./rules";

// Auction push rules (docs/auctions.md § Meldingen): quiet hours only broken for active bidders, never capped.
const night = new Date("2026-10-10T01:00:00Z");
const day = new Date("2026-10-10T12:00:00Z");
const base: PushDecisionInput = { kind: "AUCTION_OUTBID", now: day, timeZone: "UTC", quietStart: 22 * 60, quietEnd: 8 * 60, sentToday: 0, maxPerDay: 5 };

describe("auction push rules", () => {
  it("live auction pushes: dropped in quiet hours unless actively bidding", () => {
    expect(decidePush({ ...base, now: night })).toEqual({ action: "drop", reason: "quiet" });
    expect(decidePush({ ...base, now: night, activelyBidding: true })).toEqual({ action: "send" });
    expect(decidePush({ ...base, kind: "AUCTION_ENDING", now: night })).toEqual({ action: "drop", reason: "quiet" });
  });
  it("never capped", () => {
    expect(decidePush({ ...base, sentToday: 99, maxPerDay: 1 })).toEqual({ action: "send" });
    expect(decidePush({ ...base, kind: "AUCTION_WON", sentToday: 99, maxPerDay: 1 })).toEqual({ action: "send" });
  });
  it("won waits for the end of quiet hours", () => {
    expect(decidePush({ ...base, kind: "AUCTION_WON", now: night })).toMatchObject({ action: "defer", reason: "quiet" });
  });
  it("dedupe keys: outbid per 2 minutes, ending/won once", () => {
    const t = new Date("2026-10-10T12:00:30Z");
    expect(dedupeKeys.auctionOutbid("lot1", t)).toBe(dedupeKeys.auctionOutbid("lot1", new Date("2026-10-10T12:01:59Z")));
    expect(dedupeKeys.auctionOutbid("lot1", t)).not.toBe(dedupeKeys.auctionOutbid("lot1", new Date("2026-10-10T12:02:00Z")));
    expect(auctionLotIdFromDedupeKey(dedupeKeys.auctionOutbid("lot1", t))).toBe("lot1");
    expect(auctionLotIdFromDedupeKey(dedupeKeys.auctionEnding("lot2"))).toBe("lot2");
    expect(auctionLotIdFromDedupeKey("search:abc")).toBeNull();
  });
  it("payload: urgent and one notification per lot; TTL until the close", () => {
    const json = JSON.parse(buildPushPayload({ id: "m1", kind: "AUCTION_OUTBID", title: "t", body: "b", url: "/auctions/lot/lot1", dedupeKey: dedupeKeys.auctionEnding("lot1") }));
    expect(json).toMatchObject({ tag: "auction-lot1", urgent: true });
    expect(pushTtlSeconds("AUCTION_OUTBID", day, new Date(day.getTime() + 600_000))).toBe(600);
    expect(pushTtlSeconds("AUCTION_ENDING", day, new Date(day.getTime() - 1000))).toBe(30);
  });
});
