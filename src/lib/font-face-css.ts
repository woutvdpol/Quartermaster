/** One entry of a generated face table (scripts/fonts/sync-fonts.ts). */
export type FontFaceEntry = {
  faces: readonly { style: string; weight: string; unicodeRange: string; src: string }[];
  fallback: { font: string; ascent: string; descent: string; lineGap: string; sizeAdjust: string } | null;
};

/**
 * @font-face rules for one self-hosted family (`font-display: swap`) plus, when the table has metrics,
 * a size-adjusted local fallback face named `"<family> Fallback"` (what next/font generated).
 */
export function fontFaceCss(family: string, { faces, fallback }: FontFaceEntry): string {
  let css = "";
  for (const f of faces) {
    css += `@font-face{font-family:"${family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${f.src}) format("woff2");unicode-range:${f.unicodeRange}}`;
  }
  if (fallback) {
    css += `@font-face{font-family:"${family} Fallback";src:local("${fallback.font}");ascent-override:${fallback.ascent};descent-override:${fallback.descent};line-gap-override:${fallback.lineGap};size-adjust:${fallback.sizeAdjust}}`;
  }
  return css;
}
