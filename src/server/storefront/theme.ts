/**
 * Tenant appearance → CSS custom properties for `.shop-root` (see src/app/(shop)/shop.css).
 * Pure (no server-only) so it can be unit tested.
 */

const DARK_INK = "#1c1a16";
const LIGHT_INK = "#ffffff";

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour (0 = black, 1 = white). Invalid input → 0. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((x) => channel(parseInt(x, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Text colour (dark ink or white) with the better contrast on `background`. */
export function readableOn(background: string): string {
  return contrastRatio(background, LIGHT_INK) >= contrastRatio(background, DARK_INK) ? LIGHT_INK : DARK_INK;
}

export type ThemeInput = {
  colors: { primary: string; secondary: string; accent: string };
  headingFontFamily: string;
  textFontFamily: string;
};

/** The inline style object for the shop root element. */
export function shopThemeVars(input: ThemeInput): Record<`--${string}`, string> {
  const { primary, secondary, accent } = input.colors;
  return {
    "--shop-primary": primary,
    "--shop-secondary": secondary,
    "--shop-accent": accent,
    "--shop-on-primary": readableOn(primary),
    "--shop-on-secondary": readableOn(secondary),
    "--shop-on-accent": readableOn(accent),
    "--shop-font-heading": input.headingFontFamily,
    "--shop-font-body": input.textFontFamily,
  };
}
