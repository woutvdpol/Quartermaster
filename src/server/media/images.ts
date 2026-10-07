import "server-only";
import sharp, { type Metadata, type Sharp } from "sharp";

/**
 * Image processing for uploads.
 *
 * Decisions:
 *  - The "original" is kept in its source format (jpeg/png/webp/avif) but always re-encoded:
 *    auto-rotated by EXIF and stripped of all metadata (phone photos carry GPS). Re-encoding at
 *    high quality keeps a faithful master for future reprocessing / feeds that want JPEG.
 *    HEIC is not decodable by the prebuilt libvips (no HEVC) and is rejected with a clear message.
 *  - Variants are WebP q80, resized by width without upscaling:
 *      thumb 320w · card 800w · large 2000w · blur 24w (low-quality placeholder; also returned
 *      as a base64 data URL so the UI can inline it without a request).
 *  - The variant set is defined here (VARIANTS); the stored manifest records what was produced,
 *    so a changed set can be detected and reprocessed later.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;

export const VARIANTS = {
  thumb: { width: 320, quality: 80 },
  card: { width: 800, quality: 80 },
  large: { width: 2000, quality: 80 },
  blur: { width: 24, quality: 50 },
} as const;

export type VariantName = keyof typeof VARIANTS;
export const VARIANT_NAMES = Object.keys(VARIANTS) as VariantName[];

export type SourceFormat = "jpeg" | "png" | "webp" | "avif";

export const FORMAT_INFO: Record<SourceFormat, { ext: string; mime: string }> = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
  avif: { ext: "avif", mime: "image/avif" },
};

export type ProcessedFile = { data: Buffer; width: number; height: number; bytes: number };

export type ProcessedImage = {
  format: SourceFormat;
  ext: string;
  mimeType: string;
  /** Re-encoded original (rotated, metadata stripped). */
  original: ProcessedFile;
  variants: Record<VariantName, ProcessedFile & { mimeType: "image/webp" }>;
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
    const variants = {} as ProcessedImage["variants"];
    for (const name of VARIANT_NAMES) {
      const spec = VARIANTS[name];
      const file = await render(
        base.clone().resize({ width: spec.width, withoutEnlargement: true }).webp({ quality: spec.quality }),
      );
      variants[name] = { ...file, mimeType: "image/webp" };
    }
    return {
      format,
      ext: FORMAT_INFO[format].ext,
      mimeType: FORMAT_INFO[format].mime,
      original,
      variants,
      blurDataUrl: `data:image/webp;base64,${variants.blur.data.toString("base64")}`,
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError("CORRUPT", `Image could not be decoded: ${(error as Error).message}`);
  }
}
