import { describe, expect, it } from "vitest";
import {
  SETTINGS_GROUPS,
  SETTINGS_SCHEMAS,
  appearanceSchema,
  changedKeys,
  checkoutSchema,
  defaultSettings,
  mergeSettings,
  parseStoredSettings,
  analyticsSchema,
} from "./schema";

describe("settings schemas", () => {
  it.each(SETTINGS_GROUPS)("empty object parses to defaults for %s", (group) => {
    const parsed = SETTINGS_SCHEMAS[group].parse({});
    expect(parsed).toEqual(defaultSettings(group));
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
  });

  it("fills nested defaults", () => {
    expect(appearanceSchema.parse({}).colors.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(defaultSettings("checkout").reservationMinutes).toBe(15);
    expect(defaultSettings("general").address.country).toBe("NL");
    expect(appearanceSchema.parse({ colors: { primary: "#AABBCC" } }).colors).toMatchObject({
      primary: "#aabbcc",
      secondary: defaultSettings("appearance").colors.secondary,
    });
  });

  it.each(["red", "#abc", "#12345g", "123456", "#1234567"])("rejects invalid hex color %s", (color) => {
    expect(appearanceSchema.safeParse({ colors: { primary: color } }).success).toBe(false);
  });

  it("rejects fonts outside the allowlist", () => {
    expect(appearanceSchema.safeParse({ headingFont: "Comic Sans MS" }).success).toBe(false);
  });

  it("enforces reservationMinutes bounds", () => {
    expect(checkoutSchema.safeParse({ reservationMinutes: 5 }).success).toBe(true);
    expect(checkoutSchema.safeParse({ reservationMinutes: 60 }).success).toBe(true);
    expect(checkoutSchema.safeParse({ reservationMinutes: 4 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ reservationMinutes: 61 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ reservationMinutes: 15.5 }).success).toBe(false);
  });

  it("requires Matomo details when provider is matomo", () => {
    expect(analyticsSchema.safeParse({ provider: "matomo" }).success).toBe(false);
    expect(
      analyticsSchema.safeParse({ provider: "matomo", matomoUrl: "https://stats.example.com", matomoSiteId: 3 }).success,
    ).toBe(true);
  });

  it("rejects path traversal in stored paths", () => {
    expect(appearanceSchema.safeParse({ logoPath: "/uploads/t1/../../etc/passwd" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ logoPath: "https://evil.example/logo.png" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ logoPath: "/uploads/t1/branding/logo.webp" }).success).toBe(true);
  });
});

describe("helpers", () => {
  it("parseStoredSettings resets only invalid keys", () => {
    const { value, invalidKeys } = parseStoredSettings("checkout", { reservationMinutes: 999, guestCheckout: false });
    expect(value.reservationMinutes).toBe(15);
    expect(value.guestCheckout).toBe(false);
    expect(invalidKeys).toEqual(["reservationMinutes"]);
  });

  it("parseStoredSettings tolerates non-object data", () => {
    expect(parseStoredSettings("catalog", null).value).toEqual(defaultSettings("catalog"));
    expect(parseStoredSettings("catalog", [1, 2]).value).toEqual(defaultSettings("catalog"));
  });

  it("mergeSettings deep-merges objects and replaces arrays", () => {
    const merged = mergeSettings({ a: { x: 1, y: 2 }, list: [1, 2] }, { a: { y: 3 }, list: [9] });
    expect(merged).toEqual({ a: { x: 1, y: 3 }, list: [9] });
  });

  it("changedKeys reports dot-paths", () => {
    const before = defaultSettings("appearance");
    const after = appearanceSchema.parse(mergeSettings(before, { colors: { accent: "#000000" }, textFont: "Lato" }));
    expect(changedKeys(before, after).sort()).toEqual(["colors.accent", "textFont"]);
  });
});
