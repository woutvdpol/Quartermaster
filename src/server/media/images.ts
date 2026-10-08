import "server-only";
import sharp, { type Metadata, type Sharp } from "sharp";
import { SRCSET_WIDTHS } from "@/lib/media/variants";

/**
 * Image processing for uploads.
 *
 * Decisions:
 *  - The "original" is kept in its source format (jpeg/png/webp/avif) but always re-encoded:
 *    auto-rotated by EXIF and stripped of all metadata (phone photos carry GPS). Re-encoding at
 *    high quality keeps a faithful master for future reprocessing / feeds that want JPEG.
 *    HEIC is not decodable by the prebuilt libvips (no HEVC) and is rejected with a clear message.
 *  - Variants (docs/perf/round3.md): WebP q72 at the srcset widths of src/lib/media/variants.ts
 *    (thumb 320 · w480 · w640 · card 800 · w1080 · w1440 · large 2000) plus AVIF q50 (effort 3) at the
 *    same widths, resized by width without upscaling; the optional widths (w480/w640/w1080/w1440) are
 *    skipped when the source is not wider (no duplicate files). blur 24w WebP q50 is the low-quality
 *    placeholder, also returned as a base64 data URL so the UI can inline it without a request.
 *    The source is decoded once into a ≤2000 px sRGB master that every variant is resized from.
 *  - The variant set is defined here (VARIANTS); the stored manifest records what was produced, so a
 *    changed set can be detected and completed later (`npm run media:reprocess`).
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;

/** WebP / AVIF quality (round 3: AVIF q50 ≈ WebP q72 visually at ~55–65 % of the bytes). */
export const WEBP_QUALITY = 72;
export const AVIF_QUALITY = 50;
const AVIF_EFFORT = 3; // effort 4 (sharp's default) is ~3× slower for <1 % smaller files

type VariantSpec = { width: number; quality: number; avif: boolean; optional: boolean };
export const VARIANTS = {
  thumb: { width: SRCSET_WIDTHS.thumb, quality: WEBP_QUALITY, avif: true, optional: false },
  w480: { width: SRCSET_WIDTHS.w480, quality: WEBP_QUALITY, avif: true, optional: true },
  w640: { width: SRCSET_WIDTHS.w640, quality: WEBP_QUALITY, avif: true, optional: true },
  card: { width: SRCSET_WIDTHS.card, quality: WEBP_QUALITY, avif: true, optional: false },
  w1080: { width: SRCSET_WIDTHS.w1080, quality: WEBP_QUALITY, avif: true, optional: true },
  w1440: { width: SRCSET_WIDTHS.w1440, quality: WEBP_QUALITY, avif: true, optional: true },
  large: { width: SRCSET_WIDTHS.large, quality: WEBP_QUALITY, avif: true, optional: false },
  blur: { width: 24, quality: 50, avif: false, optional: false },
} as const satisfies Record<string, VariantSpec>;

export type VariantName = keyof typeof VARIANTS;
export const VARIANT_NAMES = Object.keys(VARIANTS) as VariantName[];
/** Variants every processed image has (linked by convention: admin thumbs, cart, mails …). */
export type RequiredVariant = { [K in VariantName]: (typeof VARIANTS)[K]["optional"] extends true ? never : K }[VariantName];
export const REQUIRED_VARIANTS = VARIANT_NAMES.filter((n) => !VARIANTS[n].optional) as RequiredVariant[];

/** Is `name` produced for a source `sourceWidth` px wide? Optional widths only when strictly narrower. */
export function variantApplies(name: VariantName, sourceWidth: number): boolean {
  const spec = VARIANTS[name];
  return !spec.optional || spec.width < sourceWidth;
}

export type SourceFormat = "jpeg" | "png" | "webp" | "avif";

export const FORMAT_INFO: Record<SourceFormat, { ext: string; mime: string }> = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
  avif: { ext: "avif", mime: "image/avif" },
};

export type ProcessedFile = { data: Buffer; width: number; height: number; bytes: number };
export type ProcessedVariant = ProcessedFile & { mimeType: "image/webp"; avif?: ProcessedFile & { mimeType: "image/avif" } };

export type ProcessedImage = {
  format: SourceFormat;
  ext: string;
  mimeType: string;
  /** Re-encoded original (rotated, metadata stripped). */
  original: ProcessedFile;
  /** Produced variants (optional widths are absent for narrow sources); `avif` per srcset width. */
  variants: Partial<Record<VariantName, ProcessedVariant>> & Record<RequiredVariant, ProcessedVariant>;
  /** `data:image/webp;base64,…` of the blur variant. */
  blurDataUrl: string;
};

export class ImageProcessingError extends Error {
  constructor(
    public readonly reason: "TOO_LARGE" | "TOO_MANY_PIXELS" | "UNSUPPORTED_FORMAT" | "CORRUPT" | "EMPTY",
    message: string,
  ) {
    super(message);
  }
}

/** Detects the real image type from the bytes (never from the filename / client MIME type). */
async function detectFormat(input: Buffer): Promise<{ format: SourceFormat; width: number; height: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: false }).metadata();
  } catch {
    throw new ImageProcessingError("UNSUPPORTED_FORMAT", "File is not a supported image");
  }
  let format: SourceFormat;
  switch (meta.format) {
    case "jpeg":
    case "png":
    case "webp":
      format = meta.format;
      break;
    case "heif":
      // libvips reports AVIF as heif/av1; HEIC (hevc) cannot be decoded by the bundled libheif.
      if (meta.compression !== "av1") {
        throw new ImageProcessingError("UNSUPPORTED_FORMAT", "HEIC images are not supported; export as JPEG first");
      }
      format = "avif";
      break;
    default:
      throw new ImageProcessingError("UNSUPPORTED_FORMAT", `Unsupported image format: ${meta.format ?? "unknown"}`);
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new ImageProcessingError("CORRUPT", "Image has no dimensions");
  if (width * height > MAX_PIXELS) {
    throw new ImageProcessingError("TOO_MANY_PIXELS", `Image exceeds ${MAX_PIXELS / 1_000_000} megapixels`);
  }
  return { format, width, height };
}

function encodeOriginal(pipeline: Sharp, format: SourceFormat): Sharp {
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality: 90, mozjpeg: true });
    case "png":
      return pipeline.png({ compressionLevel: 9 });
    case "webp":
      return pipeline.webp({ quality: 90 });
    case "avif":
      return pipeline.avif({ quality: 70 });
  }
}

async function render(pipeline: Sharp): Promise<ProcessedFile> {
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, bytes: data.length };
}

/** Validates and processes one uploaded image. Throws ImageProcessingError for bad input. */
export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new ImageProcessingError("EMPTY", "File is empty");
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImageProcessingError("TOO_LARGE", `Image exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const { format } = await detectFormat(buffer);

  // Output carries no metadata (sharp's default) and is converted to sRGB; autoOrient applies EXIF rotation first.
  const base = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "error" }).autoOrient();

  try {
    const original = await render(encodeOriginal(base.clone(), format));
    const all = Object.fromEntries(VARIANT_NAMES.map((n) => [n, { webp: true, avif: true }]));
    const rendered = (await renderVariants(base, all)).variants;
    const variants: Partial<Record<VariantName, ProcessedVariant>> = {};
    for (const name of VARIANT_NAMES) {
      const r = rendered[name];
      if (!r?.webp) continue;
      variants[name] = { ...r.webp, mimeType: "image/webp", ...(r.avif ? { avif: { ...r.avif, mimeType: "image/avif" as const } } : {}) };
    }
    return {
      format,
      ext: FORMAT_INFO[format].ext,
      mimeType: FORMAT_INFO[format].mime,
      original,
      variants: variants as ProcessedImage["variants"],
      blurDataUrl: `data:image/webp;base64,${variants.blur!.data.toString("base64")}`,
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    console.warn("[media] image decode failed:", (error as Error).message);
    throw new ImageProcessingError("CORRUPT", "Image could not be decoded");
  }
}

export type RenderedVariant = { webp?: ProcessedFile; avif?: ProcessedFile };

/**
 * Renders variants from an (auto-oriented) pipeline: one decode into a ≤2000 px sRGB master, then every
 * width resized from it. `want` says per variant which formats to encode (AVIF only where the spec has
 * it); optional widths that do not apply to the source are skipped. Used by uploads and the reprocess
 * script (which only asks for the files that are missing).
 */
export async function renderVariants(
  source: Sharp,
  want: Partial<Record<VariantName, { webp: boolean; avif: boolean }>>,
): Promise<{ sourceWidth: number; variants: Partial<Record<VariantName, RenderedVariant>> }> {
  const { data, info } = await source
    .clone()
    .resize({ width: VARIANTS.large.width, withoutEnlargement: true })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const variants: Partial<Record<VariantName, RenderedVariant>> = {};
  for (const name of VARIANT_NAMES) {
    const formats = want[name];
    if (!formats || !variantApplies(name, raw.width)) continue;
    const spec: VariantSpec = VARIANTS[name];
    const resized = () => sharp(data, { raw }).resize({ width: spec.width, withoutEnlargement: true });
    const entry: RenderedVariant = {};
    if (formats.webp) entry.webp = await render(resized().webp({ quality: spec.quality }));
    if (formats.avif && spec.avif) entry.avif = await render(resized().avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }));
    variants[name] = entry;
  }
  return { sourceWidth: raw.width, variants };
}
