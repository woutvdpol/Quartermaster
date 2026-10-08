/*
 * Storefront font files (docs/perf/round2.md § Fonts).
 *
 *   npm run fonts:sync     # downloads the woff2 files + regenerates the face table; commit both
 *
 * Why not next/font: next/font can only emit ONE stylesheet with the @font-face rules of every
 * declared family (all 24 allowlisted fonts × every Google subset, ~47 kB raw, render-blocking on
 * every shop page) and does not expose the hashed file URLs, so the 1–2 critical files can't be
 * preloaded per tenant. Instead this script resolves the same Google Fonts requests next/font would
 * make (its own helpers: axes, URL, fallback metrics), keeps the `latin` + `latin-ext` subsets, stores
 * the files under public/fonts/shop/ with a content hash in the name (served `immutable`, see
 * next.config.ts) and writes src/components/shop/layout/font-faces.generated.ts. The shop layout then
 * inlines @font-face rules for only the families the tenant's theme uses and preloads the latin files
 * of the heading + body face (src/components/shop/layout/fonts.ts).
 *
 * Run it after changing FONT_ALLOWLIST or the per-family options below. Needs network access.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const G = "next/dist/compiled/@next/font/dist/google";
const { validateGoogleFontFunctionCall } = require(`${G}/validate-google-font-function-call`);
const { getFontAxes } = require(`${G}/get-font-axes`);
const { getGoogleFontsUrl } = require(`${G}/get-google-fonts-url`);
const { fetchCSSFromGoogleFonts } = require(`${G}/fetch-css-from-google-fonts`);
const { getFallbackFontOverrideMetrics } = require(`${G}/get-fallback-font-override-metrics`);

type Options = { weight?: string | string[]; style?: string | string[]; adjustFontFallback?: boolean };

/** Same options as the former next/font declarations (FONT_ALLOWLIST + the theme mono face). */
const FAMILIES: Record<string, Options> = {
  Inter: {},
  Roboto: {},
  "Open Sans": {},
  Lato: { weight: ["400", "700"] },
  Montserrat: {},
  Oswald: {},
  "Bebas Neue": { weight: "400" },
  "IBM Plex Sans": {},
  "IBM Plex Serif": { weight: ["400", "600", "700"] },
  Merriweather: {},
  "Playfair Display": {},
  "Libre Baskerville": {},
  "EB Garamond": {},
  "Cormorant Garamond": {},
  "Source Serif 4": {},
  "Special Elite": { weight: "400" },
  "Hanken Grotesk": {},
  "Instrument Serif": { weight: "400", style: ["normal", "italic"] },
  Newsreader: { style: ["normal", "italic"] },
  Archivo: {},
  "Work Sans": {},
  "Libre Caslon Display": { weight: "400" },
  // next/font ships no fallback metrics for it (generic fallback: condensed Impact).
  "Big Shoulders": { adjustFontFallback: false },
  // Theme-owned mono face (stock numbers).
  "IBM Plex Mono": { weight: ["400", "500"] },
};

const SUBSETS = ["latin", "latin-ext"] as const;
const OUT_DIR = "public/fonts/shop";
const URL_BASE = "/fonts/shop";
const TABLE = "src/components/shop/layout/font-faces.generated.ts";

type Face = { subset: (typeof SUBSETS)[number]; style: string; weight: string; unicodeRange: string; src: string };
type Fallback = { font: string; ascent: string; descent: string; lineGap: string; sizeAdjust: string };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const table: Record<string, { faces: Face[]; fallback: Fallback | null }> = {};
  const fileByUrl = new Map<string, string>();
  let totalBytes = 0;

  for (const [family, options] of Object.entries(FAMILIES)) {
    const v = validateGoogleFontFunctionCall(family.replace(/ /g, "_"), { ...options, subsets: ["latin"], display: "swap" });
    const axes = getFontAxes(v.fontFamily, v.weights, v.styles, v.selectedVariableAxes);
    const url = getGoogleFontsUrl(v.fontFamily, axes, "swap");
    const css: string = await fetchCSSFromGoogleFonts(url, v.fontFamily, false);
    const faces: Face[] = [];
    // Google's response: "/* subset */\n@font-face { … }" blocks.
    for (const m of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g)) {
      const subset = m[1] as Face["subset"];
      if (!SUBSETS.includes(subset)) continue;
      const body = m[2];
      const prop = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";
      const remote = /url\(([^)]+)\)/.exec(prop("src"))?.[1];
      if (!remote) throw new Error(`${family}: no src in ${body}`);
      let file = fileByUrl.get(remote);
      if (!file) {
        const res = await fetch(remote);
        if (!res.ok) throw new Error(`${family}: ${res.status} for ${remote}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const hash = createHash("sha256").update(buf).digest("hex").slice(0, 10);
        file = `${slug(family)}-${subset}-${slug(prop("font-style"))}-${slug(prop("font-weight"))}.${hash}.woff2`;
        writeFileSync(join(OUT_DIR, file), buf);
        totalBytes += buf.length;
        fileByUrl.set(remote, file);
      }
      faces.push({ subset, style: prop("font-style"), weight: prop("font-weight"), unicodeRange: prop("unicode-range"), src: `${URL_BASE}/${file}` });
    }
    if (!faces.some((f) => f.subset === "latin")) throw new Error(`${family}: no latin faces`);
    const m = options.adjustFontFallback === false ? undefined : getFallbackFontOverrideMetrics(v.fontFamily);
    const fallback = m ? { font: m.fallbackFont, ascent: m.ascentOverride, descent: m.descentOverride, lineGap: m.lineGapOverride, sizeAdjust: m.sizeAdjust } : null;
    table[family] = { faces, fallback };
    console.log(`${family.padEnd(22)} ${faces.length} faces${fallback ? "" : " (no fallback metrics)"}`);
  }

  writeFileSync(
    TABLE,
    `// GENERATED by scripts/fonts/sync-shop-fonts.ts (npm run fonts:sync) — do not edit by hand.\n` +
      `// Files live in public/${URL_BASE.slice(1)}/ (content-hashed names, served immutable).\n\n` +
      `export type ShopFontFace = { subset: "latin" | "latin-ext"; style: string; weight: string; unicodeRange: string; src: string };\n` +
      `export type ShopFontFallback = { font: string; ascent: string; descent: string; lineGap: string; sizeAdjust: string };\n\n` +
      `export const SHOP_FONT_FACES = ${JSON.stringify(table, null, 2)} as const satisfies Record<string, { faces: readonly ShopFontFace[]; fallback: ShopFontFallback | null }>;\n`,
  );
  console.log(`\n${readdirSync(OUT_DIR).length} files, ${Math.round(totalBytes / 1024)} kB → ${OUT_DIR}; table → ${TABLE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
