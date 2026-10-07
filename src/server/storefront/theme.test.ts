import { describe, expect, it } from "vitest";
import { contrastRatio, readableOn, relativeLuminance, shopThemeVars } from "./theme";

describe("storefront theme", () => {
  it("computes luminance", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("nope")).toBe(0);
  });

  it("picks readable text colours", () => {
    expect(readableOn("#3f4a2c")).toBe("#ffffff"); // olive
    expect(readableOn("#c2b280")).toBe("#1c1a16"); // khaki
    expect(readableOn("#8b1e1e")).toBe("#ffffff");
    expect(readableOn("#ffff00")).toBe("#1c1a16");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
  });

  it("emits all shop variables", () => {
    const vars = shopThemeVars({
      colors: { primary: "#3f4a2c", secondary: "#c2b280", accent: "#8b1e1e" },
      headingFontFamily: "Oswald",
      textFontFamily: "Inter",
    });
    expect(vars["--shop-primary"]).toBe("#3f4a2c");
    expect(vars["--shop-on-secondary"]).toBe("#1c1a16");
    expect(vars["--shop-font-heading"]).toBe("Oswald");
  });
});
