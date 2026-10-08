import { ADMIN_FONT_FACES } from "./admin-font-faces.generated";
import { fontFaceCss } from "./font-face-css";

/*
 * Fonts for all admin themes, exposed as CSS variables. globals.css maps each theme's
 * --qm-font-display / -label / -body / -mono onto these variables.
 *
 * Self-hosted, no next/font (docs/perf/round2.md § Fonts): `next/font/google` downloaded the files
 * from Google during `next build`, so a flaky network broke (Docker) builds. The woff2 files (latin +
 * latin-ext, same weights as before) live in public/fonts/admin/ with content-hashed names (served
 * immutable) and are listed in admin-font-faces.generated.ts — both written by `npm run fonts:sync`
 * (scripts/fonts/sync-fonts.ts, using next/font's own helpers and fallback metrics). The admin layout
 * inlines ADMIN_FONT_CSS (@font-face rules + size-adjusted fallback faces + the variables on
 * `.qm-admin-fonts`, ~9 kB raw / small gzipped; covered by CSP `style-src 'unsafe-inline'`).
 *
 * Preloading: only the BODY face of design A ("depot", the default) is preloaded, and only its `latin`
 * file (IBM Plex Sans is one variable file for all weights). The display/label face (Barlow Condensed),
 * the mono face and every latin-ext file load on first use (`font-display: swap` with size-adjusted
 * fallbacks). Preloading all of them (12 files, ~175 kB incl. latin-ext files a page rarely needs)
 * competed with CSS/JS and cost ~0.5 s mobile LCP. B and C fonts load on demand when those themes are
 * selected (an unused @font-face never downloads).
 *
 * Note: Google renamed "Big Shoulders Stencil Display" to the variable "Big Shoulders Stencil"
 * (with an optical-size axis); large headings automatically get the display cut. next/font has no
 * fallback metrics for it, so it has no fallback face (globals.css falls back to Arial Narrow/Impact).
 */

type AdminFamily = keyof typeof ADMIN_FONT_FACES;

/** CSS variable per family (names kept from next/font; globals.css refers to them). */
const VARIABLES: Record<AdminFamily, `--font-${string}`> = {
  // A · Depot
  "Barlow Condensed": "--font-barlow-condensed",
  "IBM Plex Sans": "--font-ibm-plex-sans",
  "IBM Plex Mono": "--font-ibm-plex-mono",
  // B · Field Ledger
  "Big Shoulders Stencil": "--font-big-shoulders-stencil",
  "Public Sans": "--font-public-sans",
  "JetBrains Mono": "--font-jetbrains-mono",
  // C · Naval Quiet
  "Hanken Grotesk": "--font-hanken-grotesk",
  "Sofia Sans Condensed": "--font-sofia-sans-condensed",
  "Geist Mono": "--font-geist-mono",
};

const families = Object.keys(VARIABLES) as AdminFamily[];
/** Own family names, prefixed so a locally installed copy (or a storefront face) is never picked up. */
const own = (name: AdminFamily) => `QM Admin ${name}`;

/** Class that defines every admin font variable; put it on the admin root element. */
export const adminFontVariables = "qm-admin-fonts";

/** Inline stylesheet: @font-face rules (+ fallback faces) and the variables on `.qm-admin-fonts`. */
export const ADMIN_FONT_CSS =
  families.map((name) => fontFaceCss(own(name), ADMIN_FONT_FACES[name])).join("") +
  `.${adminFontVariables}{${families
    .map((name) => `${VARIABLES[name]}:"${own(name)}"${ADMIN_FONT_FACES[name].fallback ? `,"${own(name)} Fallback"` : ""}`)
    .join(";")}}`;

/** The one preloaded file: the latin IBM Plex Sans file (regular weight; variable, covers 400–700). */
export const ADMIN_FONT_PRELOAD: string = (() => {
  const face = ADMIN_FONT_FACES["IBM Plex Sans"].faces.find((f) => f.subset === "latin" && f.style === "normal" && f.weight === "400");
  if (!face) throw new Error("admin fonts: no latin IBM Plex Sans 400 face (run npm run fonts:sync)");
  return face.src;
})();
