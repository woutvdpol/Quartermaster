import { describe, expect, it } from "vitest";
import {
  DEFAULT_INCREMENT_TABLE,
  defaultReservePrice,
  defaultStartPrice,
  incrementFor,
  nextMinimum,
  parseIncrementTable,
  roundStartPrice,
  tableOrDefault,
} from "./increments";
import {
  EMPTY_LOT_STATE,
  applyBid,
  checkBid,
  closesAsSold,
  extendClose,
  minimumFor,
  replayBids,
  reserveMet,
  scheduledClose,
  visibleHistory,
  type EngineConfig,
  type LotState,
} from "./engine";

const cfg = (startPrice = 5000, reservePrice: number | null = null): EngineConfig => ({ startPrice, reservePrice, table: DEFAULT_INCREMENT_TABLE });

function run(bids: [string, number][], c: EngineConfig = cfg()): LotState {
  let s: LotState = EMPTY_LOT_STATE;
  for (const [customerId, maxAmount] of bids) s = applyBid(s, { customerId, maxAmount }, c).state;
  return s;
}

describe("increments", () => {
  it.each([
    [0, 500],
    [9_999, 500],
    [10_000, 1_000], // "up to €100" is exclusive
    [49_999, 1_000],
    [50_000, 2_500],
    [99_999, 2_500],
    [100_000, 5_000],
    [10_000_000, 5_000],
  ])("incrementFor(%i) = %i", (amount, step) => expect(incrementFor(amount)).toBe(step));

  it("nextMinimum: start price without bids, else current + step", () => {
    expect(nextMinimum(null, 5000)).toBe(5000);
    expect(nextMinimum(5000, 5000)).toBe(5500);
    expect(nextMinimum(9500, 5000)).toBe(10000);
    expect(nextMinimum(10000, 5000)).toBe(11000);
    expect(nextMinimum(97500, 5000)).toBe(100000);
    expect(nextMinimum(100000, 5000)).toBe(105000);
  });

  it("uses a custom table", () => {
    const t = parseIncrementTable([{ upTo: 2000, step: 100 }, { upTo: null, step: 1000 }])!;
    expect(incrementFor(1999, t)).toBe(100);
    expect(incrementFor(2000, t)).toBe(1000);
    expect(nextMinimum(1500, 100, t)).toBe(1600);
  });

  it("rejects invalid tables and falls back to the default", () => {
    expect(parseIncrementTable([])).toBeNull();
    expect(parseIncrementTable([{ upTo: 100, step: 5 }])).toBeNull(); // no open last band
    expect(parseIncrementTable([{ upTo: 100, step: 5 }, { upTo: 50, step: 5 }, { upTo: null, step: 10 }])).toBeNull();
    expect(parseIncrementTable([{ upTo: null, step: 0 }])).toBeNull();
    expect(parseIncrementTable("nope")).toBeNull();
    expect(tableOrDefault(null)).toBe(DEFAULT_INCREMENT_TABLE);
    expect(tableOrDefault([{ upTo: 1, step: -1 }])).toBe(DEFAULT_INCREMENT_TABLE);
  });

  it("default start and reserve prices", () => {
    expect(defaultStartPrice(145_000)).toBe(87_000); // 60%, €10 steps below €1,000
    expect(defaultStartPrice(300_000)).toBe(180_000);
    expect(defaultStartPrice(310_000)).toBe(185_000); // €50 steps from €1,000
    expect(defaultStartPrice(10_000)).toBe(6_000);
    expect(defaultStartPrice(1_500)).toBe(900);
    expect(defaultStartPrice(100)).toBe(100); // never below €1
    expect(roundStartPrice(12_345)).toBe(12_000);
    expect(defaultReservePrice(88_000)).toBe(96_800);
    expect(defaultReservePrice(1_234)).toBe(1_400); // rounded up to whole euros
    expect(defaultReservePrice(20_250, 6_500)).toBe(6_500); // never above the list price
    expect(defaultReservePrice(null)).toBeNull();
    expect(defaultReservePrice(0)).toBeNull();
  });
});

describe("proxy bidding", () => {
  it("first bid opens at the start price, whatever the maximum", () => {
    const out = applyBid(EMPTY_LOT_STATE, { customerId: "a", maxAmount: 20000 }, cfg());
    expect(out.state).toEqual({ current: 5000, leaderId: "a", leadingMax: 20000 });
    expect(out.kind).toBe("first");
    expect(out.steps).toEqual([{ customerId: "a", amount: 5000, maxAmount: 20000, isAuto: false }]);
  });

  it("a higher challenger leads at one step above the old maximum", () => {
    const s = run([["a", 8000]]);
    const out = applyBid(s, { customerId: "b", maxAmount: 12000 }, cfg());
    expect(out.state).toEqual({ current: 8500, leaderId: "b", leadingMax: 12000 });
    expect(out.kind).toBe("new-leader");
    expect(out.displacedLeaderId).toBe("a");
    expect(out.steps).toEqual([
      { customerId: "a", amount: 8000, maxAmount: 8000, isAuto: true },
      { customerId: "b", amount: 8500, maxAmount: 12000, isAuto: false },
    ]);
  });

  it("a challenger just one cent over the maximum leads at their own maximum", () => {
    const s = run([["a", 8000]]);
    const out = applyBid(s, { customerId: "b", maxAmount: 8001 }, { ...cfg(), startPrice: 5000 });
    expect(out.state.current).toBe(8001);
    expect(out.state.leaderId).toBe("b");
  });

  it("exact increment edge: challenger max = L + increment(L)", () => {
    const s = run([["a", 9500]]);
    const out = applyBid(s, { customerId: "b", maxAmount: 10000 }, cfg());
    expect(out.state).toEqual({ current: 10000, leaderId: "b", leadingMax: 10000 });
    // Next step is now in the €10 band.
    expect(minimumFor(out.state, "c", cfg())).toBe(11000);
  });

  it("a lower challenger is answered by the leader's proxy", () => {
    const s = run([["a", 20000]]);
    const out = applyBid(s, { customerId: "b", maxAmount: 7000 }, cfg());
    expect(out.state).toEqual({ current: 7500, leaderId: "a", leadingMax: 20000 });
    expect(out.kind).toBe("outbid");
    expect(out.displacedLeaderId).toBeNull();
    expect(out.steps).toEqual([
      { customerId: "b", amount: 7000, maxAmount: 7000, isAuto: false },
      { customerId: "a", amount: 7500, maxAmount: 20000, isAuto: true },
    ]);
  });

  it("the leader's proxy never goes above its maximum", () => {
    const s = run([["a", 7200]]);
    const out = applyBid(s, { customerId: "b", maxAmount: 7000 }, { ...cfg(), startPrice: 5000 });
    expect(out.state).toEqual({ current: 7200, leaderId: "a", leadingMax: 7200 });
  });

  it("ties: the earlier bid wins at the shared maximum", () => {
    const s = run([["a", 9000]]);
    const out = applyBid(s, { customerId: "b", maxAmount: 9000 }, cfg());
    expect(out.state).toEqual({ current: 9000, leaderId: "a", leadingMax: 9000 });
    expect(out.steps.map((r) => [r.customerId, r.amount, r.isAuto])).toEqual([
      ["b", 9000, false],
      ["a", 9000, true],
    ]);
  });

  it("the leader raising their maximum only changes the maximum", () => {
    const s = run([["a", 8000], ["b", 6000]]); // current 6500, a leads
    expect(s.current).toBe(6500);
    const out = applyBid(s, { customerId: "a", maxAmount: 30000 }, cfg());
    expect(out.kind).toBe("raise");
    expect(out.state).toEqual({ current: 6500, leaderId: "a", leadingMax: 30000 });
    expect(out.steps).toEqual([{ customerId: "a", amount: 6500, maxAmount: 30000, isAuto: false }]);
  });

  it("a leader must go above their own maximum; others above current + step", () => {
    const s = run([["a", 8000], ["b", 6000]]);
    expect(minimumFor(s, "a", cfg())).toBe(8001);
    expect(minimumFor(s, "c", cfg())).toBe(7000);
    expect(checkBid(s, { customerId: "a", maxAmount: 8000 }, cfg())).toEqual({ ok: false, reason: "BELOW_MINIMUM", minimum: 8001 });
    expect(checkBid(s, { customerId: "c", maxAmount: 6999 }, cfg())).toEqual({ ok: false, reason: "BELOW_MINIMUM", minimum: 7000 });
    expect(checkBid(s, { customerId: "c", maxAmount: 7000 }, cfg())).toEqual({ ok: true });
    expect(checkBid(EMPTY_LOT_STATE, { customerId: "c", maxAmount: 4999 }, cfg())).toEqual({ ok: false, reason: "BELOW_MINIMUM", minimum: 5000 });
    expect(() => applyBid(s, { customerId: "c", maxAmount: 100 }, cfg())).toThrow();
  });

  it("a bidding war ends one step above the second-highest maximum", () => {
    const s = run([["a", 15000], ["b", 9000], ["c", 12000], ["b", 14000], ["d", 30000]]);
    expect(s).toEqual({ current: 16000, leaderId: "d", leadingMax: 30000 }); // 15,000 + €10
  });

  it("the price never goes down", () => {
    const s = run([["a", 6000], ["b", 20000]]); // b leads at 6500
    expect(s.current).toBe(6500);
    const out = applyBid(s, { customerId: "c", maxAmount: 7000 }, cfg());
    expect(out.state.current).toBe(7500);
  });

  describe("reserve", () => {
    it("jumps to the reserve when the leader's maximum reaches it", () => {
      const c = cfg(5000, 9000);
      const out = applyBid(EMPTY_LOT_STATE, { customerId: "a", maxAmount: 10000 }, c);
      expect(out.state.current).toBe(9000);
      expect(reserveMet(out.state.current, 9000)).toBe(true);
    });

    it("stays at the start price below the reserve", () => {
      const c = cfg(5000, 9000);
      const out = applyBid(EMPTY_LOT_STATE, { customerId: "a", maxAmount: 8000 }, c);
      expect(out.state.current).toBe(5000);
      expect(reserveMet(out.state.current, 9000)).toBe(false);
    });

    it("a leader raising to the reserve lifts the price to it", () => {
      const c = cfg(5000, 9000);
      const s = run([["a", 8000]], c);
      const out = applyBid(s, { customerId: "a", maxAmount: 12000 }, c);
      expect(out.state.current).toBe(9000);
    });

    it("an outbid challenger below the reserve leaves the price capped by the leader's max", () => {
      const c = cfg(5000, 20000);
      const s = run([["a", 15000], ["b", 9000]], c);
      expect(s.current).toBe(9500); // 9,000 + €5, reserve not reachable by a's 15,000
      expect(reserveMet(s.current, 20000)).toBe(false);
    });

    it("no reserve → reserveMet is null", () => {
      expect(reserveMet(5000, null)).toBeNull();
      expect(reserveMet(null, 100)).toBe(false);
    });
  });
});

describe("replay (void a bid)", () => {
  it("recomputes from the remaining submissions", () => {
    const subs = [
      { customerId: "a", maxAmount: 8000 },
      { customerId: "b", maxAmount: 12000 },
      { customerId: "c", maxAmount: 10000 },
    ];
    expect(replayBids(subs, cfg()).state).toEqual({ current: 11000, leaderId: "b", leadingMax: 12000 });
    // Void b's bid: a and c remain.
    const out = replayBids([subs[0], subs[2]], cfg());
    expect(out.state).toEqual({ current: 8500, leaderId: "c", leadingMax: 10000 });
    expect(out.stepsBySubmission.map((s) => s.length)).toEqual([1, 2]);
  });

  it("empty after voiding everything", () => {
    expect(replayBids([], cfg()).state).toEqual(EMPTY_LOT_STATE);
  });

  it("matches incremental bidding", () => {
    const bids: [string, number][] = [["a", 6000], ["b", 7000], ["a", 9000], ["c", 9000], ["b", 25000], ["b", 40000]];
    const subs = bids.map(([customerId, maxAmount]) => ({ customerId, maxAmount }));
    expect(replayBids(subs, cfg()).state).toEqual(run(bids));
  });
});

describe("extension and schedule", () => {
  const close = new Date("2026-10-12T20:00:00Z");
  it("extends a bid inside the window to now + window", () => {
    const now = new Date("2026-10-12T19:59:30Z");
    expect(extendClose(close, now, 120)).toEqual({ closesAt: new Date("2026-10-12T20:01:30Z"), extended: true });
  });
  it("extends exactly at the window edge", () => {
    const now = new Date("2026-10-12T19:58:00Z");
    expect(extendClose(close, now, 120)).toEqual({ closesAt: new Date("2026-10-12T20:00:00Z"), extended: false });
    const later = new Date("2026-10-12T19:58:00.001Z");
    expect(extendClose(close, later, 120).extended).toBe(true);
  });
  it("does nothing before the window or without a window", () => {
    expect(extendClose(close, new Date("2026-10-12T19:57:59Z"), 120)).toEqual({ closesAt: close, extended: false });
    expect(extendClose(close, new Date("2026-10-12T19:59:59Z"), 0)).toEqual({ closesAt: close, extended: false });
  });
  it("scheduled closes", () => {
    const first = new Date("2026-10-12T19:00:00Z");
    expect(scheduledClose("DAY", first, 60, 1)).toEqual(first);
    expect(scheduledClose("DAY", first, 60, 11)).toEqual(new Date("2026-10-12T19:10:00Z"));
    expect(scheduledClose("SINGLE", first, 60, 11)).toEqual(first);
  });
});

describe("history and closing", () => {
  it("hides a leader's own raise in the public history", () => {
    const rows = [
      { customerId: "a", amount: 5000 },
      { customerId: "b", amount: 5500 },
      { customerId: "a", amount: 6000 },
      { customerId: "a", amount: 6000 }, // raise
      { customerId: "c", amount: 7000 },
    ];
    expect(visibleHistory(rows).map((r) => `${r.customerId}${r.amount}`)).toEqual(["a5000", "b5500", "a6000", "c7000"]);
  });
  it("sold only with a bid at or above the reserve", () => {
    expect(closesAsSold(null, null, null)).toBe(false);
    expect(closesAsSold(5000, "a", null)).toBe(true);
    expect(closesAsSold(5000, "a", 6000)).toBe(false);
    expect(closesAsSold(6000, "a", 6000)).toBe(true);
  });
});
