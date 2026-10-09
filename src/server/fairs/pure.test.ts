import { describe, expect, it } from "vitest";
import { computeFairReport, defaultFloorPrice, effectiveFloor, stockCodeFromScan, type FairSaleFact } from "./pure";
import { enqueueSale, syncOutcome, type QueuedSale } from "./queue";

describe("defaultFloorPrice", () => {
  it("takes list −15% rounded to a price-dependent step", () => {
    expect(defaultFloorPrice(145000)).toBe(125000); // €1,450 → €1,250 (step €50)
    expect(defaultFloorPrice(14500)).toBe(12000); // €145 → €120 (step €10)
    expect(defaultFloorPrice(4500)).toBe(4000); // €45 → €40 (step €5)
    expect(defaultFloorPrice(1000)).toBe(900); // €10 → €9 (step €1)
  });
  it("never exceeds the list price or goes negative", () => {
    expect(defaultFloorPrice(100)).toBe(100);
    expect(defaultFloorPrice(0)).toBe(0);
    expect(defaultFloorPrice(-5)).toBe(0);
  });
  it("falls back to the list price when no floor is set", () => {
    expect(effectiveFloor(null, 5000)).toBe(5000);
    expect(effectiveFloor(4000, 5000)).toBe(4000);
  });
});

describe("stockCodeFromScan", () => {
  it("reads bare numbers and printed variants", () => {
    expect(stockCodeFromScan("50160")).toBe(50160);
    expect(stockCodeFromScan(" No. 50160 ")).toBe(50160);
    expect(stockCodeFromScan("#42")).toBe(42);
  });
  it("reads the stock code from a label URL", () => {
    expect(stockCodeFromScan("https://shop.example/product/50160")).toBe(50160);
    expect(stockCodeFromScan("https://shop.example/product/50160/stahlhelm-m40?x=1")).toBe(50160);
  });
  it("rejects anything else", () => {
    expect(stockCodeFromScan("")).toBeNull();
    expect(stockCodeFromScan("abc")).toBeNull();
    expect(stockCodeFromScan("0")).toBeNull();
    expect(stockCodeFromScan("https://shop.example/category/5")).toBeNull();
  });
});

describe("computeFairReport", () => {
  const sale = (over: Partial<FairSaleFact>): FairSaleFact => ({
    orderId: "o",
    orderNumber: 1,
    stockCode: 1,
    title: "Item",
    price: 10000,
    listPrice: 10000,
    purchasePrice: 5000,
    method: "card",
    soldAt: "2026-10-12T10:00:00Z",
    ...over,
  });

  it("sums revenue, methods, margin and cash", () => {
    const r = computeFairReport([
      sale({ orderId: "a", price: 135000, listPrice: 145000, purchasePrice: 88000, method: "card", soldAt: "2026-10-12T10:00:00Z" }),
      sale({ orderId: "b", price: 14000, listPrice: 14500, purchasePrice: null, method: "cash", soldAt: "2026-10-12T12:00:00Z" }),
      sale({ orderId: "c", price: 4000, listPrice: 4500, purchasePrice: 2000, method: "cash", soldAt: "2026-10-12T11:00:00Z" }),
      sale({ orderId: "d", price: 1000, listPrice: 1000, purchasePrice: 1000, method: "invoice", soldAt: "2026-10-12T09:00:00Z" }),
    ]);
    expect(r.count).toBe(4);
    expect(r.revenue).toBe(154000);
    expect(r.byMethod.card).toEqual({ count: 1, amount: 135000 });
    expect(r.byMethod.cash).toEqual({ count: 2, amount: 18000 });
    expect(r.byMethod.invoice).toEqual({ count: 1, amount: 1000 });
    expect(r.cashExpected).toBe(18000);
    expect(r.margin).toBe(47000 + 2000 + 0);
    expect(r.marginUnknown).toBe(1);
    expect(r.listTotal).toBe(165000);
    expect(r.averageVsList).toBeCloseTo(-11000 / 165000);
    expect(r.latest.map((s) => s.orderId)).toEqual(["b", "c", "a", "d"]);
  });

  it("handles an empty fair", () => {
    const r = computeFairReport([]);
    expect(r).toMatchObject({ count: 0, revenue: 0, margin: 0, averageVsList: null, cashExpected: 0, latest: [] });
  });
});

describe("offline queue", () => {
  const q = (ref: string): QueuedSale => ({
    clientRef: ref,
    fairId: "f",
    productId: "p",
    stockCode: 1,
    title: "Item",
    price: 100,
    method: "cash",
    buyerEmail: null,
    allowBelowFloor: false,
    soldAt: "2026-10-12T10:00:00Z",
    attempts: 0,
    state: "pending",
    error: null,
  });

  it("never queues the same clientRef twice", () => {
    const one = enqueueSale([], q("r1"));
    expect(enqueueSale(one, q("r1"))).toBe(one);
    expect(enqueueSale(one, q("r2")).map((s) => s.clientRef)).toEqual(["r1", "r2"]);
  });

  it("classifies sync responses", () => {
    expect(syncOutcome(200, { ok: true })).toBe("done");
    expect(syncOutcome(409, { ok: false, code: "CONFLICT" })).toBe("rejected");
    expect(syncOutcome(422, { ok: false, code: "INVALID" })).toBe("rejected");
    expect(syncOutcome(404, { ok: false, code: "NOT_FOUND" })).toBe("rejected");
    expect(syncOutcome(401, { ok: false })).toBe("auth");
    expect(syncOutcome(500, null)).toBe("retry");
    expect(syncOutcome(0, null)).toBe("retry");
  });
});
