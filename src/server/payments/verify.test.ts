import { describe, expect, it } from "vitest";
import { verifyMolliePayment, type ExpectedMolliePayment } from "./verify";

const expected: ExpectedMolliePayment = {
  providerPaymentId: "tr_abc12345",
  amount: 10695,
  currency: "EUR",
  orderTotal: 10695,
  orderCurrency: "EUR",
  mode: "live",
  tenantId: "t1",
  orderId: "o1",
};
const good = { id: "tr_abc12345", mode: "live", amount: { value: "106.95", currency: "EUR" }, metadata: { tenantId: "t1", orderId: "o1", orderNumber: 7 } };
const reasons = (over: Record<string, unknown>, exp: Partial<ExpectedMolliePayment> = {}) => verifyMolliePayment({ ...good, ...over }, { ...expected, ...exp }).map((m) => m.reason);

describe("verifyMolliePayment (R3)", () => {
  it("accepts our own payment", () => {
    expect(verifyMolliePayment(good, expected)).toEqual([]);
    expect(reasons({ amount: { value: "106.950", currency: "eur" } })).toEqual([]); // canonicalised
  });

  it("flags amount, currency, mode, metadata and id differences", () => {
    expect(reasons({ amount: { value: "106.94", currency: "EUR" } })).toEqual(["AMOUNT"]);
    expect(reasons({ amount: { value: "0.01", currency: "EUR" } })).toEqual(["AMOUNT"]);
    expect(reasons({ amount: { value: "106.95", currency: "USD" } })).toEqual(["CURRENCY"]);
    expect(reasons({ amount: null })).toEqual(["CURRENCY", "AMOUNT"]);
    expect(reasons({ mode: "test" })).toEqual(["MODE"]);
    expect(reasons({ metadata: { tenantId: "t2", orderId: "o1" } })).toEqual(["TENANT"]);
    expect(reasons({ metadata: { tenantId: "t1", orderId: "o2" } })).toEqual(["ORDER"]);
    expect(reasons({ metadata: null })).toEqual(["TENANT", "ORDER"]);
    expect(reasons({ id: "tr_other0001" })).toEqual(["ID"]);
  });

  it("requires the attempt amount to equal the order total too", () => {
    expect(reasons({}, { orderTotal: 10000 })).toEqual(["AMOUNT"]);
    expect(reasons({}, { orderCurrency: "GBP" })).toEqual(["CURRENCY"]);
  });

  it("handles zero-decimal currencies", () => {
    const jpy = { ...expected, amount: 1234, orderTotal: 1234, currency: "JPY", orderCurrency: "JPY" };
    expect(verifyMolliePayment({ ...good, amount: { value: "1234", currency: "JPY" } }, jpy)).toEqual([]);
    expect(verifyMolliePayment({ ...good, amount: { value: "1235", currency: "JPY" } }, jpy).map((m) => m.reason)).toEqual(["AMOUNT"]);
  });
});
