import { PLATFORM_FONT_FACES } from "./platform-font-faces.generated";
import { fontFaceCss } from "./font-face-css";

/*
 * Fonts for the platform pages on PLATFORM_HOST (landing; DESIGN.md), exposed as CSS variables that
 * shop.css maps onto font-pf-display / font-pf-body / font-pf-mono.
 *
 * Self-hosted like the admin fonts (src/lib/admin-fonts.ts): woff2 files in public/fonts/platform/,
 * face table written by `npm run fonts:sync platform`. The landing inlines PLATFORM_FONT_CSS and
 * preloads the two latin files the first viewport needs: Barlow 600 (the headline, LCP) and Hanken
 * Grotesk (one variable file for all body weights). The mono face and latin-ext files load on use.
 */

type PlatformFamily = keyof typeof PLATFORM_FONT_FACES;

const VARIABLES: Record<PlatformFamily, `--${string}`> = {
  Barlow: "--qm-pf-font-display",
  "Hanken Grotesk": "--qm-pf-font-body",
  "IBM Plex Mono": "--qm-pf-font-mono",
};

const families = Object.keys(VARIABLES) as PlatformFamily[];
/** Own family names, so a locally installed copy (or an admin/storefront face) is never picked up. */
const own = (name: PlatformFamily) => `QM Platform ${name}`;

/** Class that defines the platform font variables; put it on the platform page root element. */
export const platformFontVariables = "qm-platform-fonts";

/** Inline stylesheet: @font-face rules (+ fallback faces) and the variables on `.qm-platform-fonts`. */
export const PLATFORM_FONT_CSS =
  families.map((name) => fontFaceCss(own(name), PLATFORM_FONT_FACES[name])).join("") +
  `.${platformFontVariables}{${families
    .map((name) => `${VARIABLES[name]}:"${own(name)}"${PLATFORM_FONT_FACES[name].fallback ? `,"${own(name)} Fallback"` : ""}`)
    .join(";")}}`;

function latinFile(family: PlatformFamily, weight: string): string {
  const face = PLATFORM_FONT_FACES[family].faces.find((f) => f.subset === "latin" && f.style === "normal" && f.weight === weight);
  if (!face) throw new Error(`platform fonts: no latin ${family} ${weight} face (run npm run fonts:sync platform)`);
  return face.src;
}

/** The preloaded files: the headline face and the (variable) body face, latin only. */
export const PLATFORM_FONT_PRELOADS: readonly string[] = [latinFile("Barlow", "600"), latinFile("Hanken Grotesk", "100 900")];
