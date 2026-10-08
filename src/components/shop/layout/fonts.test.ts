import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_ALLOWLIST, SHOP_THEMES } from "@/server/settings/schema";
import { SHOP_FONT_FACES } from "./font-faces.generated";
import { shopFontFaceCss, shopFontFamily, shopFontPreloads, shopFontTables, shopFontsInUse, shopThemeFontFamilies } from "./fonts";

describe("storefront fonts", () => {
  it("has self-hosted latin faces (files present) for every allowlisted font and the mono face", () => {
    for (const name of [...FONT_ALLOWLIST, "IBM Plex Mono"] as const) {
      const entry = SHOP_FONT_FACES[name];
      expect(entry, name).toBeDefined();
      expect(entry.faces.some((f) => f.subset === "latin" && f.style === "normal"), name).toBe(true);
      for (const f of entry.faces) {
        expect(f.src).toMatch(/^\/fonts\/shop\/[a-z0-9-]+\.[0-9a-f]{10}\.woff2$/);
        expect(existsSync(join(process.cwd(), "public", f.src)), f.src).toBe(true);
      }
    }
  });

  it("declares only the families the theme uses", () => {
    const families = shopFontsInUse({ theme: "gallery", headingFont: "Hanken Grotesk", textFont: "Hanken Grotesk" });
    expect(families).toEqual(["Hanken Grotesk", "Instrument Serif", "IBM Plex Mono"]);
    const css = shopFontFaceCss(families);
    expect(css).toContain('font-family:"QM Hanken Grotesk"');
    expect(css).toContain('font-family:"QM Hanken Grotesk Fallback";src:local("Arial")');
    expect(css).toContain("font-display:swap");
    expect(css).not.toContain("Inter");
  });

  it("preloads one latin file per distinct body/heading face", () => {
    expect(shopFontPreloads({ theme: "gallery", headingFont: "Hanken Grotesk", textFont: "Hanken Grotesk" })).toHaveLength(1);
    const two = shopFontPreloads({ theme: "fieldkit", headingFont: "Big Shoulders", textFont: "Inter" });
    expect(two).toHaveLength(2);
    expect(two.every((href) => href.includes("-latin-normal-"))).toBe(true);
    // Static weights: Lato body → the 400 file; IBM Plex Serif heading in "gallery" (600) → the 600 file.
    const [body, heading] = shopFontPreloads({ theme: "gallery", headingFont: "IBM Plex Serif", textFont: "Lato" });
    expect(body).toMatch(/lato-latin-normal-400\./);
    expect(heading).toMatch(/ibm-plex-serif-latin-normal-600\./);
  });

  it("builds font-family values with own family, metric fallback and generic fallback", () => {
    expect(shopFontFamily("Inter")).toBe(`"QM Inter", "QM Inter Fallback", system-ui, -apple-system, 'Segoe UI', sans-serif`);
    expect(shopFontFamily("Newsreader")).toMatch(/^"QM Newsreader", "QM Newsreader Fallback", Georgia, serif$/);
    // No fallback metrics for Big Shoulders.
    expect(shopFontFamily("Big Shoulders")).toBe(`"QM Big Shoulders", Impact, 'Arial Narrow', sans-serif`);
    for (const theme of SHOP_THEMES) expect(shopThemeFontFamilies(theme).mono).toMatch(/^"QM IBM Plex Mono"/);
  });

  it("gives the theme preview the rules of every family (loaded on demand)", () => {
    const { fonts, themes, faceCss } = shopFontTables();
    expect(Object.keys(fonts).sort()).toEqual([...FONT_ALLOWLIST].sort());
    for (const theme of SHOP_THEMES) expect(faceCss[themes[theme].accentFont]).toContain("@font-face");
    expect(faceCss["IBM Plex Mono"]).toContain("@font-face");
  });
});
