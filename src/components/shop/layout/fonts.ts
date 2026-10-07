import {
  Bebas_Neue,
  Cormorant_Garamond,
  EB_Garamond,
  IBM_Plex_Sans,
  IBM_Plex_Serif,
  Inter,
  Lato,
  Libre_Baskerville,
  Merriweather,
  Montserrat,
  Open_Sans,
  Oswald,
  Playfair_Display,
  Roboto,
  Source_Serif_4,
  Special_Elite,
} from "next/font/google";
import type { FONT_ALLOWLIST } from "@/server/settings/schema";

/*
 * Self-hosted storefront fonts (appearance.headingFont / textFont, FONT_ALLOWLIST).
 *
 * next/font needs every font declared statically with literal options (no spreads), so all 16 are declared here. `preload: false`
 * on all of them: the @font-face rules are tiny and the browser only downloads the files of the
 * two families the shop actually uses (fonts are fetched on first use), so nothing unused is
 * transferred. We cannot <link rel=preload> just the chosen pair because next/font does not expose
 * the hashed file URLs; `display: swap` keeps text visible meanwhile.
 */
type FontName = (typeof FONT_ALLOWLIST)[number];

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
};

const SERIF = new Set<FontName>(["IBM Plex Serif", "Merriweather", "Playfair Display", "Libre Baskerville", "EB Garamond", "Cormorant Garamond", "Source Serif 4"]);

/** CSS font-family value for an allowlisted font, with a sensible generic fallback. */
export function shopFontFamily(name: FontName): string {
  const family = FONTS[name]?.style.fontFamily ?? "system-ui";
  return `${family}, ${SERIF.has(name) ? "Georgia, serif" : "system-ui, -apple-system, 'Segoe UI', sans-serif"}`;
}
