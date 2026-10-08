import {
  Barlow_Condensed,
  Big_Shoulders_Stencil,
  Geist_Mono,
  Hanken_Grotesk,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  JetBrains_Mono,
  Public_Sans,
  Sofia_Sans_Condensed,
} from "next/font/google";

/*
 * Fonts for all admin themes, exposed as CSS variables. globals.css maps each theme's
 * --qm-font-display / -label / -body / -mono onto these variables.
 *
 * Preloading (docs/perf/round2.md): only the BODY face of design A ("depot", the default) is preloaded,
 * and only its `latin` file (IBM Plex Sans is one variable file for all weights). The display/label
 * face (Barlow Condensed), the mono face and every latin-ext file load on first use (`display: swap`
 * with size-adjusted fallbacks). Preloading all of them (12 files, ~175 kB incl. latin-ext files a
 * page rarely needs) competed with CSS/JS and cost ~0.5 s mobile LCP. B and C fonts are still
 * self-hosted but load on demand when those themes are selected. `subsets` only controls preloading:
 * next/font still declares the latin-ext faces.
 *
 * Note: Google renamed "Big Shoulders Stencil Display" to the variable "Big Shoulders Stencil"
 * (with an optical-size axis); large headings automatically get the display cut. next/font has no
 * fallback metrics for it, so the build prints a harmless "Failed to find font override values" warning.
 */

// A · Depot
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
  preload: false,
});
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
  preload: false,
});

// B · Field Ledger
const bigShouldersStencil = Big_Shoulders_Stencil({
  subsets: ["latin"],
  variable: "--font-big-shoulders-stencil",
  display: "swap",
  preload: false,
  // next/font has no fallback metrics for this family (it warns on every build).
  adjustFontFallback: false,
});
const publicSans = Public_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-public-sans",
  display: "swap",
  preload: false,
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  preload: false,
});

// C · Naval Quiet
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--font-hanken-grotesk",
  display: "swap",
  preload: false,
});
const sofiaSansCondensed = Sofia_Sans_Condensed({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sofia-sans-condensed",
  display: "swap",
  preload: false,
});
const geistMono = Geist_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
});

/** Class names that define every admin font variable; put them on the admin root element. */
export const adminFontVariables = [
  barlowCondensed,
  ibmPlexSans,
  ibmPlexMono,
  bigShouldersStencil,
  publicSans,
  jetbrainsMono,
  hankenGrotesk,
  sofiaSansCondensed,
  geistMono,
]
  .map((font) => font.variable)
  .join(" ");
