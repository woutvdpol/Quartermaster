/*
 * Self-hosted web fonts for the storefront and the admin (docs/perf/round2.md § Fonts).
 *
 *   npm run fonts:sync     # downloads the woff2 files + regenerates the face tables; commit all of it
 *
 * Why not next/font: for the storefront, next/font can only emit ONE stylesheet with the @font-face
 * rules of every declared family (all 24 allowlisted fonts × every Google subset, ~47 kB raw,
 * render-blocking on every shop page) and does not expose the hashed file URLs, so the 1–2 critical
 * files can't be preloaded per tenant. For both areas, `next/font/google` downloads the files from
 * Google during `next build`, so a flaky network broke (Docker) builds. Instead this script resolves
 * the same Google Fonts requests next/font would make (its own helpers: axes, URL, fallback metrics),
 * keeps the `latin` + `latin-ext` subsets, stores the files under public/fonts/<set>/ with a content
 * hash in the name (served `immutable`, see next.config.ts) and writes a generated face table per set:
 *
 *   shop  → public/fonts/shop/,  src/components/shop/layout/font-faces.generated.ts
 *           (inlined per tenant theme by src/components/shop/layout/fonts.ts)
 *   admin → public/fonts/admin/, src/lib/admin-font-faces.generated.ts (src/lib/admin-fonts.ts)
 *
 * Run it after changing FONT_ALLOWLIST, the admin themes' fonts or the per-family options below.
 * Needs network access; `next build` does not.
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

type FontSet = {
  /** Directory name under public/fonts/ and URL path segment. */
  name: string;
  /** Exported constant + type-name prefix in the generated table. */
  constName: string;
  typePrefix: string;
  table: string;
  /** Same options as the former next/font declarations. */
  families: Record<string, Options>;
};

const SETS: FontSet[] = [
  {
    name: "shop",
    constName: "SHOP_FONT_FACES",
    typePrefix: "Shop",
    table: "src/components/shop/layout/font-faces.generated.ts",
    // FONT_ALLOWLIST + the theme mono face.
    families: {
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
    },
  },
  {
    name: "admin",
    constName: "ADMIN_FONT_FACES",
    typePrefix: "Admin",
    table: "src/lib/admin-font-faces.generated.ts",
    // Admin themes A · Depot, B · Field Ledger, C · Naval Quiet (src/app/globals.css).
    families: {
      "Barlow Condensed": { weight: ["500", "600", "700"] },
      "IBM Plex Sans": { weight: ["400", "500", "600", "700"] },
      "IBM Plex Mono": { weight: ["400", "500"] },
      // next/font ships no fallback metrics for it.
      "Big Shoulders Stencil": { adjustFontFallback: false },
      "Public Sans": {},
      "JetBrains Mono": {},
      "Hanken Grotesk": {},
      "Sofia Sans Condensed": {},
      "Geist Mono": {},
    },
  },
];

const SUBSETS = ["latin", "latin-ext"] as const;

type Face = { subset: (typeof SUBSETS)[number]; style: string; weight: string; unicodeRange: string; src: string };
type Fallback = { font: string; ascent: string; descent: string; lineGap: string; sizeAdjust: string };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function syncSet(set: FontSet): Promise<number> {
  const outDir = `public/fonts/${set.name}`;
  const urlBase = `/fonts/${set.name}`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const table: Record<string, { faces: Face[]; fallback: Fallback | null }> = {};
  const fileByUrl = new Map<string, string>();
  let totalBytes = 0;

  console.log(`── ${set.name}`);
  for (const [family, options] of Object.entries(set.families)) {
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
        writeFileSync(join(outDir, file), buf);
        totalBytes += buf.length;
        fileByUrl.set(remote, file);
      }
      faces.push({ subset, style: prop("font-style"), weight: prop("font-weight"), unicodeRange: prop("unicode-range"), src: `${urlBase}/${file}` });
    }
    if (!faces.some((f) => f.subset === "latin")) throw new Error(`${family}: no latin faces`);
    const m = options.adjustFontFallback === false ? undefined : getFallbackFontOverrideMetrics(v.fontFamily);
    const fallback = m ? { font: m.fallbackFont, ascent: m.ascentOverride, descent: m.descentOverride, lineGap: m.lineGapOverride, sizeAdjust: m.sizeAdjust } : null;
    table[family] = { faces, fallback };
    console.log(`${family.padEnd(22)} ${faces.length} faces${fallback ? "" : " (no fallback metrics)"}`);
  }

  const p = set.typePrefix;
  writeFileSync(
    set.table,
    `// GENERATED by scripts/fonts/sync-fonts.ts (npm run fonts:sync) — do not edit by hand.\n` +
      `// Files live in public${urlBase}/ (content-hashed names, served immutable).\n\n` +
      `export type ${p}FontFace = { subset: "latin" | "latin-ext"; style: string; weight: string; unicodeRange: string; src: string };\n` +
      `export type ${p}FontFallback = { font: string; ascent: string; descent: string; lineGap: string; sizeAdjust: string };\n\n` +
      `export const ${set.constName} = ${JSON.stringify(table, null, 2)} as const satisfies Record<string, { faces: readonly ${p}FontFace[]; fallback: ${p}FontFallback | null }>;\n`,
  );
  console.log(`${readdirSync(outDir).length} files, ${Math.round(totalBytes / 1024)} kB → ${outDir}; table → ${set.table}\n`);
  return totalBytes;
}

async function main() {
  for (const set of SETS) await syncSet(set);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
