/*
 * Theme builder: presets, the draft shape and the contrast guard.
 * Pure (no server-only, no DB) so the admin builder (client), the services and tests share it.
 *
 * A preset = layout character in CSS (`.shop-root[data-shop-theme=…]`, src/app/(shop)/shop.css)
 * + the default colours/fonts/tunables below, which the builder fills in when the owner picks the
 * preset and which they can then tune. Designs: docs/design/shop-options + docs/design/onboarding/Main.
 */
import { z } from "zod";
import { appearanceSchema, type FONT_ALLOWLIST, type Settings, type SHOP_THEMES } from "@/server/settings/schema";
import { contrastRatio, readableOn } from "@/server/storefront/theme";

export type ShopTheme = (typeof SHOP_THEMES)[number];
export type ShopFont = (typeof FONT_ALLOWLIST)[number];
export type Appearance = Settings<"appearance">;

/** The appearance keys the theme builder owns (banner / CTA images stay elsewhere). */
export const THEME_KEYS = ["theme", "colors", "headingFont", "textFont", "corners", "buttonShape", "density", "logoPath"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

/** A complete theme (draft or live): the builder-owned subset of appearance settings. */
export const themeSchema = appearanceSchema.pick({
  theme: true,
  colors: true,
  headingFont: true,
  textFont: true,
  corners: true,
  buttonShape: true,
  density: true,
  logoPath: true,
});
export type Theme = z.output<typeof themeSchema>;

/** Setting group holding the unpublished draft (outside SETTINGS_SCHEMAS: never shown in the generic settings UI). */
export const THEME_DRAFT_GROUP = "appearanceDraft";

export function pickTheme(appearance: Appearance): Theme {
  return {
    theme: appearance.theme,
    colors: { ...appearance.colors },
    headingFont: appearance.headingFont,
    textFont: appearance.textFont,
    corners: appearance.corners,
    buttonShape: appearance.buttonShape,
    density: appearance.density,
    logoPath: appearance.logoPath,
  };
}

/** Theme keys whose value differs (dot paths for colours), e.g. ["theme", "colors.primary"]. */
export function themeChanges(a: Theme, b: Theme): string[] {
  const out: string[] = [];
  for (const k of THEME_KEYS) {
    if (k === "colors") {
      for (const c of ["primary", "secondary", "accent"] as const) if (a.colors[c] !== b.colors[c]) out.push(`colors.${c}`);
    } else if (a[k] !== b[k]) out.push(k);
  }
  return out;
}

export type ThemePreset = {
  id: ShopTheme;
  name: string;
  blurb: string;
  /** Builder defaults applied when the preset is picked (logo is kept). */
  defaults: Omit<Theme, "theme" | "logoPath">;
  /**
   * Nominal neutrals with the default secondary colour (for preset-card swatches and the contrast
   * guard). The real values are derived in shop.css from the tenant's secondary colour.
   */
  palette: { bg: string; sunken: string; ink: string; muted: string; headerBg: string; headerInk: string };
  dark: boolean;
};

export const THEME_PRESETS: Record<ShopTheme, ThemePreset> = {
  gallery: {
    id: "gallery",
    name: "Gallery",
    blurb: "Clean, modern, large photos",
    defaults: {
      colors: { primary: "#1f4d3a", secondary: "#d9d6ce", accent: "#7a2420" },
      headingFont: "Hanken Grotesk",
      textFont: "Hanken Grotesk",
      corners: "soft",
      buttonShape: "pill",
      density: "comfortable",
    },
    palette: { bg: "#ffffff", sunken: "#f3f3f1", ink: "#141414", muted: "#6a6862", headerBg: "#ffffff", headerInk: "#141414" },
    dark: false,
  },
  archive: {
    id: "archive",
    name: "Archive",
    blurb: "Auction catalogue, serif, numbered lots",
    defaults: {
      colors: { primary: "#1e1c17", secondary: "#e3dccb", accent: "#7a2420" },
      headingFont: "Newsreader",
      textFont: "IBM Plex Sans",
      corners: "sharp",
      buttonShape: "square",
      density: "comfortable",
    },
    palette: { bg: "#f4f0e6", sunken: "#e3dccb", ink: "#1e1c17", muted: "#5b5547", headerBg: "#f4f0e6", headerInk: "#1e1c17" },
    dark: false,
  },
  fieldkit: {
    id: "fieldkit",
    name: "Field Kit",
    blurb: "Utilitarian spec sheet, olive and orange",
    defaults: {
      // Mockup orange #a84e14 darkened slightly to pass AA as text on the khaki ground.
      colors: { primary: "#9c4812", secondary: "#cfc8b2", accent: "#9c4812" },
      headingFont: "Big Shoulders",
      textFont: "Archivo",
      corners: "sharp",
      buttonShape: "square",
      density: "compact",
    },
    palette: { bg: "#e6e1d2", sunken: "#cfc8b2", ink: "#23281b", muted: "#5e5a4a", headerBg: "#2f3524", headerInk: "#e6e1d2" },
    dark: false,
  },
  vault: {
    id: "vault",
    name: "Vault",
    blurb: "Dark and premium, brass accents",
    defaults: {
      colors: { primary: "#d2b07a", secondary: "#1d1e1a", accent: "#d2b07a" },
      headingFont: "Libre Caslon Display",
      textFont: "Work Sans",
      corners: "sharp",
      buttonShape: "square",
      density: "spacious",
    },
    palette: { bg: "#121311", sunken: "#1d1e1a", ink: "#ece6d8", muted: "#b7b0a0", headerBg: "#121311", headerInk: "#ece6d8" },
    dark: true,
  },
};

export const PRESET_ORDER: ShopTheme[] = ["gallery", "archive", "fieldkit", "vault"];

/** Switch preset: preset defaults for colours, fonts and shape; the logo stays. */
export function applyPreset(current: Theme, preset: ShopTheme): Theme {
  const p = THEME_PRESETS[preset];
  return { ...p.defaults, colors: { ...p.defaults.colors }, theme: preset, logoPath: current.logoPath };
}

// ─── Contrast guard (warn, never block) ─────────────────────────────────────

export type ContrastWarning = { key: "primary" | "secondary" | "accent"; message: string; ratio: number };

/** WCAG AA for normal text. */
const AA = 4.5;

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Checks the tenant colours against the preset's background and ink. The background is nominal
 * (derived in CSS from the secondary colour), so ratios are close approximations.
 */
export function contrastWarnings(theme: Pick<Theme, "theme" | "colors">): ContrastWarning[] {
  const { palette } = THEME_PRESETS[theme.theme];
  const { primary, secondary, accent } = theme.colors;
  const out: ContrastWarning[] = [];

  const onPrimary = contrastRatio(primary, readableOn(primary));
  if (onPrimary < AA) out.push({ key: "primary", ratio: round(onPrimary), message: `Button text on the primary colour is hard to read (${round(onPrimary)}:1).` });
  const primaryText = contrastRatio(primary, palette.bg);
  if (primaryText < AA) out.push({ key: "primary", ratio: round(primaryText), message: `Links in the primary colour are hard to read on the background (${round(primaryText)}:1).` });

  const accentText = contrastRatio(accent, palette.bg);
  if (accentText < AA) out.push({ key: "accent", ratio: round(accentText), message: `Stock numbers in the accent colour are hard to read on the background (${round(accentText)}:1).` });

  const tint = contrastRatio(palette.ink, secondary);
  if (tint < AA) out.push({ key: "secondary", ratio: round(tint), message: `Text on tinted panels is hard to read with this background tint (${round(tint)}:1).` });

  return out;
}
