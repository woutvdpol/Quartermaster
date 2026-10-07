import { describe, expect, it } from "vitest";
import { isValidMollieKeyFormat, maskMollieKey, mollieModeFromKey, parseStoredPaymentsSettings, toMollieAmount } from "./settings";

const key30 = "abcdefghijklmnopqrstuvwxyz1234";

describe("Mollie key helpers", () => {
  it("accepts test_/live_ keys only", () => {
    expect(isValidMollieKeyFormat(`test_${key30}`)).toBe(true);
    expect(isValidMollieKeyFormat(`live_${key30}`)).toBe(true);
    expect(isValidMollieKeyFormat(`access_${key30}`)).toBe(false);
    expect(isValidMollieKeyFormat(`test_${key30.slice(1)}`)).toBe(false);
    expect(isValidMollieKeyFormat(`test_${key30}!`)).toBe(false);
    expect(isValidMollieKeyFormat(` test_${key30}`)).toBe(false);
  });
  it("derives the mode from the prefix", () => {
    expect(mollieModeFromKey(`live_${key30}`)).toBe("live");
    expect(mollieModeFromKey(`test_${key30}`)).toBe("test");
    expect(mollieModeFromKey("nope")).toBeNull();
  });
  it("masks all but the last 4 characters", () => {
    expect(maskMollieKey("live", "1234")).toBe("live_••••••••1234");
    expect(maskMollieKey(null, "1234")).toBeNull();
  });
});

describe("parseStoredPaymentsSettings", () => {
  it("defaults to not configured", () => {
    expect(parseStoredPaymentsSettings(null).mollie).toEqual({ apiKeyEncrypted: null, mode: null, keyHint: null, verifiedAt: null, enabledMethods: [] });
    expect(parseStoredPaymentsSettings({ mollie: { mode: "bogus" } }).mollie.apiKeyEncrypted).toBeNull();
  });
});

describe("toMollieAmount", () => {
  it("formats minor units with the currency's decimals", () => {
    expect(toMollieAmount(1234, "EUR")).toEqual({ currency: "EUR", value: "12.34" });
    expect(toMollieAmount(5, "eur")).toEqual({ currency: "EUR", value: "0.05" });
    expect(toMollieAmount(0, "USD")).toEqual({ currency: "USD", value: "0.00" });
    expect(toMollieAmount(1234, "JPY")).toEqual({ currency: "JPY", value: "1234" });
  });
  it("rejects fractional or negative amounts", () => {
    expect(() => toMollieAmount(1.5, "EUR")).toThrow();
    expect(() => toMollieAmount(-1, "EUR")).toThrow();
  });
});
