/*
 * Client-side photo preparation for photo search: phone photos are 3–12 MB; the model only looks at
 * 224 × 224 pixels. Downscaling to ≤ 768 px JPEG before upload makes the request ~50–150 kB
 * (faster on mobile data, well under the 10 MB limit) without changing the match.
 */

export const PHOTO_MAX_SIDE = 768;
export const PHOTO_QUALITY = 0.85;
/** Server limit (src/server/search/image-input.ts SEARCH_IMAGE_MAX_BYTES). */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** Formats /api/search/image decodes (anything else is re-encoded as JPEG here). */
const SERVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Target size that fits within `max` on the longest side (never upscales). */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether a picked/pasted/dropped file looks like an image (some phones send an empty type). */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || (!file.type && /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(file.name));
}

/**
 * Decodes (honouring EXIF orientation), downsizes and re-encodes as JPEG. Falls back to the original
 * file when the browser cannot decode it (e.g. HEIC outside Safari) — the server then decides.
 */
export async function downscalePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
    // Keep the original only when the server can read it and it is already smaller (tiny PNG/WebP).
    if (!blob) return file;
    return SERVER_TYPES.has(file.type) && file.size <= blob.size ? file : blob;
  } finally {
    bitmap.close();
  }
}
