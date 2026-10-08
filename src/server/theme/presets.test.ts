import { describe, expect, it } from "vitest";
import { appearanceSchema, parseStoredSettings, SHOP_THEMES } from "@/server/settings/schema";
import { shopThemeVars } from "@/server/storefront/theme";
import { PRESET_ORDER, THEME_PRESETS, applyPreset, contrastWarnings, pickTheme, themeChanges, themeSchema } from "./presets";

const base = pickTheme(appearanceSchema.parse({}));

describe("theme schema", () => {
  it("defaults keep the Gallery look for stored settings without the new keys", () => {
    const { value, invalidKeys } = parseStoredSettings("appearance", { theme: "gallery", colors: { primary: "#112233" } });
    expect(invalidKeys).toEqual([]);
    expect(value).toMatchObject({ theme: "gallery", corners: "soft", buttonShape: "pill", density: "comfortable" });
  });

  it("accepts every preset and tunable, rejects unknown ones", () => {
    for (const theme of SHOP_THEMES) expect(appearanceSchema.safeParse({ theme }).success).toBe(true);
    expect(appearanceSchema.safeParse({ theme: "neon" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ corners: "blob" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ buttonShape: "circle" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ density: "huge" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ headingFont: "Comic Sans" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ headingFont: "Big Shoulders" }).success).toBe(true);
  });

  it("the draft schema only holds builder keys and validates like appearance", () => {
    const parsed = themeSchema.parse({ ...base, bannerPath: "/uploads/x/banner.webp" });
    expect(parsed).not.toHaveProperty("bannerPath");
    expect(themeSchema.safeParse({ ...base, colors: { ...base.colors, primary: "red" } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...base, logoPath: "https://evil.test/x.png" }).success).toBe(false);
    expect(themeSchema.safeParse({ ...base, logoPath: "/uploads/../etc/passwd" }).success).toBe(false);
  });
});

describe("presets", () => {
  it("has a preset definition for every theme", () => {
    expect([...PRESET_ORDER].sort()).toEqual([...SHOP_THEMES].sort());
  });

  it.each(PRESET_ORDER)("preset %s defaults are valid and pass the contrast guard", (id) => {
    const t = applyPreset(base, id);
    expect(themeSchema.safeParse(t).success).toBe(true);
    expect(t.theme).toBe(id);
    expect(contrastWarnings(t)).toEqual([]);
  });

  it("applying a preset keeps the logo", () => {
    const t = applyPreset({ ...base, logoPath: "/uploads/t1/branding/logo-ab.webp" }, "vault");
    expect(t.logoPath).toBe("/uploads/t1/branding/logo-ab.webp");
    expect(t).toMatchObject({ corners: "sharp", buttonShape: "square", headingFont: "Libre Caslon Display" });
  });

  it("lists changed keys", () => {
    expect(themeChanges(base, base)).toEqual([]);
    const next = { ...applyPreset(base, "archive"), logoPath: base.logoPath };
    expect(themeChanges(next, base)).toEqual(expect.arrayContaining(["theme", "colors.primary", "headingFont", "corners", "buttonShape"]));
  });
});

describe("contrast guard", () => {
  it("warns about unreadable colours", () => {
    const pale = { theme: "gallery" as const, colors: { primary: "#ffee88", secondary: "#d9d6ce", accent: "#ffdd00" } };
    const keys = contrastWarnings(pale).map((w) => w.key);
    expect(keys).toContain("primary");
    expect(keys).toContain("accent");
  });

  it("warns when a light tint is used on the dark Vault preset", () => {
    const w = contrastWarnings({ theme: "vault", colors: { ...THEME_PRESETS.vault.defaults.colors, secondary: "#f0f0f0" } });
    expect(w.map((x) => x.key)).toEqual(["secondary"]);
  });

  it("warns about a dark primary on Vault (links on near-black)", () => {
    const w = contrastWarnings({ theme: "vault", colors: { ...THEME_PRESETS.vault.defaults.colors, primary: "#1f4d3a" } });
    expect(w.some((x) => x.key === "primary")).toBe(true);
  });
});

describe("token mapping of tunables", () => {
  const input = { colors: base.colors, headingFontFamily: "A", textFontFamily: "B" };
  it.each([
    ["sharp", "0px", "0px"],
    ["soft", "6px", "6px"],
    ["round", "14px", "10px"],
  ] as const)("corners %s", (corners, r, sm) => {
    const v = shopThemeVars({ ...input, corners });
    expect(v["--shop-radius"]).toBe(r);
    expect(v["--shop-radius-sm"]).toBe(sm);
  });
  it.each([
    ["square", "0px"],
    ["rounded", "8px"],
    ["pill", "999px"],
  ] as const)("buttons %s", (buttonShape, r) => {
    expect(shopThemeVars({ ...input, buttonShape })["--shop-radius-control"]).toBe(r);
  });
  it.each([
    ["compact", "0.75"],
    ["comfortable", "1"],
    ["spacious", "1.3"],
  ] as const)("density %s", (density, d) => {
    expect(shopThemeVars({ ...input, density })["--shop-density"]).toBe(d);
  });
  it("omits tunable vars when not given (CSS preset fallbacks apply)", () => {
    const v = shopThemeVars(input);
    expect(v).not.toHaveProperty("--shop-radius");
    expect(v).not.toHaveProperty("--shop-density");
  });
  it("vault's brass primary gets dark button text", () => {
    expect(shopThemeVars({ ...input, colors: THEME_PRESETS.vault.defaults.colors })["--shop-on-primary"]).toBe("#1c1a16");
  });
});
