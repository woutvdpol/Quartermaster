/**
 * Responsive image variants of stored uploads — shared by the server (manifest → URLs) and the shop UI
 * (srcset/sizes). Pure module: no sharp, no server-only.
 *
 * Storage layout (src/server/media): original `{base}.{ext}`, variants `{base}/{name}.webp` and, for
 * the srcset widths, `{base}/{name}.avif`. `thumb`, `card`, `large` and `blur` always exist for a
 * processed image (other code links them by convention); `w480`, `w640`, `w1080` and `w1440` only
 * when the source is wider than that (no upscaled duplicates). Every srcset width also exists as AVIF.
 * Images processed before round 3 of the performance work have only thumb/card/large/blur WebP until
 * `npm run media:reprocess` adds the rest; everything here degrades to what the manifest lists.
 */

/** Nominal widths of the srcset variants, ascending (docs/perf/round3.md § Breedtes). */
export const SRCSET_WIDTHS = {
  thumb: 320,
  w480: 480,
  w640: 640,
  card: 800,
  w1080: 1080,
  w1440: 1440,
  large: 2000,
} as const;

export type SrcsetVariant = keyof typeof SRCSET_WIDTHS;
export const SRCSET_VARIANTS = Object.keys(SRCSET_WIDTHS) as SrcsetVariant[];

/** One width of a responsive image: the WebP URL and, when it exists, the AVIF URL. */
export type ImageSource = { w: number; webp: string; avif?: string };

/** Manifest entry as stored in ProductImage.variants / content `manifest.json` (subset used here). */
export type ManifestLike = Partial<Record<string, { key?: string; width?: number; avif?: { key?: string } } | undefined>>;

/**
 * Responsive sources from a variant manifest, ascending by width, one per distinct real width (a small
 * original yields e.g. card = large = 500 px; the first is kept). Null when the image has no srcset
 * variants (unprocessed).
 */
export function sourcesFromManifest(manifest: ManifestLike | null | undefined): ImageSource[] | null {
  if (!manifest) return null;
  const out: ImageSource[] = [];
  for (const name of SRCSET_VARIANTS) {
    const e = manifest[name];
    if (!e?.key) continue;
    const w = Number(e.width) || SRCSET_WIDTHS[name];
    if (out.some((s) => s.w === w)) continue;
    out.push({ w, webp: `/uploads/${e.key}`, ...(e.avif?.key ? { avif: `/uploads/${e.avif.key}` } : {}) });
  }
  out.sort((a, b) => a.w - b.w);
  return out.length ? out : null;
}

/**
 * Which widths a rendering offers the browser. Offering every width everywhere costs HTML bytes (each
 * URL appears twice: in the markup and in the RSC payload), so each context lists what it can use:
 *  - `card`: product cards, tiles, thumbnails (rendered 120–380 css px; ≤ 800 px covers DPR 2–3 phones)
 *  - `wide`: hero, gallery, banner, content images (rendered 340–1300 css px)
 */
export type SrcsetProfile = "card" | "wide";
const PROFILE_RANGE: Record<SrcsetProfile, [number, number]> = { card: [0, 800], wide: [480, 2000] };

/** Sources within the profile's width range (never empty when `sources` is not). */
export function pickSources(sources: ImageSource[], profile: SrcsetProfile): ImageSource[] {
  const [min, max] = PROFILE_RANGE[profile];
  const picked = sources.filter((s) => s.w >= min && s.w <= max);
  if (picked.length) return picked;
  return [sources[sources.length - 1]];
}

/** `srcset` strings for a list of sources; `avif` lists the widths that have an AVIF file (null: none). */
export function srcSets(sources: ImageSource[]): { webp: string; avif: string | null } {
  const webp = sources.map((s) => `${s.webp} ${s.w}w`).join(", ");
  const withAvif = sources.filter((s) => s.avif);
  const avif = withAvif.length ? withAvif.map((s) => `${s.avif} ${s.w}w`).join(", ") : null;
  return { webp, avif };
}
