import {
  Archivo,
  Bebas_Neue,
  Big_Shoulders,
  Cormorant_Garamond,
  EB_Garamond,
  Hanken_Grotesk,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Serif,
  Instrument_Serif,
  Inter,
  Lato,
  Libre_Caslon_Display,
  Libre_Baskerville,
  Merriweather,
  Montserrat,
  Newsreader,
  Open_Sans,
  Oswald,
  Playfair_Display,
  Roboto,
  Source_Serif_4,
  Special_Elite,
  Work_Sans,
} from "next/font/google";
import type { FONT_ALLOWLIST, SHOP_THEMES } from "@/server/settings/schema";

/*
 * Self-hosted storefront fonts (appearance.headingFont / textFont, FONT_ALLOWLIST).
 *
 * next/font needs every font declared statically with literal options (no spreads), so every allowlisted font is declared here. `preload: false`
 * on all of them: the @font-face rules are tiny and the browser only downloads the files of the
 * two families the shop actually uses (fonts are fetched on first use), so nothing unused is
 * transferred. We cannot <link rel=preload> just the chosen pair because next/font does not expose
 * the hashed file URLs; `display: swap` keeps text visible meanwhile.
 */
type FontName = (typeof FONT_ALLOWLIST)[number];
type ShopTheme = (typeof SHOP_THEMES)[number];

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const roboto = Roboto({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const openSans = Open_Sans({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const lato = Lato({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "700"] });
const montserrat = Montserrat({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const oswald = Oswald({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const bebasNeue = Bebas_Neue({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: "400" });
const ibmPlexSans = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const ibmPlexSerif = IBM_Plex_Serif({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "600", "700"] });
const merriweather = Merriweather({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const playfairDisplay = Playfair_Display({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const libreBaskerville = Libre_Baskerville({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const ebGaramond = EB_Garamond({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const cormorantGaramond = Cormorant_Garamond({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const sourceSerif4 = Source_Serif_4({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const specialElite = Special_Elite({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: "400" });
const hankenGrotesk = Hanken_Grotesk({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const instrumentSerif = Instrument_Serif({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: "400", style: ["normal", "italic"] });
const newsreader = Newsreader({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, style: ["normal", "italic"] });
const archivo = Archivo({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const bigShoulders = Big_Shoulders({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, adjustFontFallback: false });
const workSans = Work_Sans({ subsets: ["latin", "latin-ext"], display: "swap", preload: false });
const libreCaslonDisplay = Libre_Caslon_Display({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: "400" });

// Theme-owned roles (not tenant-selectable): the "accent" serif for emphasised words in headings and
// the mono face for stock numbers. Theme presets pick these; see SHOP_THEMES.
const plexMono = IBM_Plex_Mono({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "500"] });

const FONTS: Record<FontName, { style: { fontFamily: string } }> = {
  Inter: inter,
  Roboto: roboto,
  "Open Sans": openSans,
  Lato: lato,
  Montserrat: montserrat,
  Oswald: oswald,
  "Bebas Neue": bebasNeue,
  "IBM Plex Sans": ibmPlexSans,
  "IBM Plex Serif": ibmPlexSerif,
  Merriweather: merriweather,
  "Playfair Display": playfairDisplay,
  "Libre Baskerville": libreBaskerville,
  "EB Garamond": ebGaramond,
  "Cormorant Garamond": cormorantGaramond,
  "Source Serif 4": sourceSerif4,
  "Special Elite": specialElite,
  "Hanken Grotesk": hankenGrotesk,
  "Instrument Serif": instrumentSerif,
  Newsreader: newsreader,
  Archivo: archivo,
  "Big Shoulders": bigShoulders,
  "Work Sans": workSans,
  "Libre Caslon Display": libreCaslonDisplay,
};

const SERIF = new Set<FontName>(["Instrument Serif", "Newsreader", "Libre Caslon Display", "IBM Plex Serif", "Merriweather", "Playfair Display", "Libre Baskerville", "EB Garamond", "Cormorant Garamond", "Source Serif 4"]);

/** CSS font-family value for an allowlisted font, with a sensible generic fallback. */
export function shopFontFamily(name: FontName): string {
  const family = FONTS[name]?.style.fontFamily ?? "system-ui";
  return `${family}, ${SERIF.has(name) ? "Georgia, serif" : "system-ui, -apple-system, 'Segoe UI', sans-serif"}`;
}

/** Font roles a theme preset fixes (accent serif + mono), as CSS font-family values. */
export function shopThemeFontFamilies(theme: ShopTheme): { accent: string; mono: string } {
  switch (theme) {
    case "gallery":
      return { accent: shopFontFamily("Instrument Serif"), mono: `${plexMono.style.fontFamily}, ui-monospace, SFMono-Regular, Menlo, monospace` };
  }
}
