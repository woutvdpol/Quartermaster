import type { Settings } from "@/server/settings/schema";
import { shopFontFaceCss, shopFontPreloads, shopFontsInUse } from "./fonts";

/**
 * The storefront's web fonts (src/components/shop/layout/fonts.ts): inline @font-face rules for only
 * the families this theme uses (hoisted into <head> by React) and a preload for the latin body and
 * heading files, so text renders in the right face on first paint without a font-CSS request.
 */
export function ShopFonts({ appearance }: { appearance: Pick<Settings<"appearance">, "theme" | "headingFont" | "textFont"> }) {
  const families = shopFontsInUse(appearance);
  // Rendered as elements (React hoists both into <head>); `ReactDOM.preload()` from a server component
  // only reached the RSC payload here, not the streamed HTML head.
  return (
    <>
      {shopFontPreloads(appearance).map((href) => (
        <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
      ))}
      {/* `href` is React's dedupe key; no spaces (React matches it as a space-separated list). */}
      <style href={`qm-fonts-${families.map((f) => f.toLowerCase().replace(/[^a-z0-9]+/g, "-")).join("_")}`} precedence="default">
        {shopFontFaceCss(families)}
      </style>
    </>
  );
}
