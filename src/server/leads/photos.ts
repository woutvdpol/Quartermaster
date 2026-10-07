import "server-only";
import sharp from "sharp";
import { randomAlnum } from "./draft";
import { sniffImageType } from "./sniff";

/*
 * Lead photo processing. Visitors are untrusted: the real type is checked from the magic bytes
 * (JPEG/PNG/WebP only), then the image is fully decoded and re-encoded by sharp (EXIF rotation
 * applied, all metadata incl. GPS stripped, max 2000 px) — the stored file is never the uploaded
 * byte stream. A 320 px WebP thumbnail is stored next to it for the admin and the owner mail.
 *
 * Keys: see ./keys.ts.
 */

export const LEAD_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 2000;
const THUMB_WIDTH = 320;

export class LeadPhotoError extends Error {
  constructor(
    public readonly reason: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED" | "CORRUPT",
    message: string,
  ) {
    super(message);
  }
}

export type ProcessedLeadPhoto = { file: string; full: Buffer; thumb: Buffer; width: number; height: number };

export async function processLeadPhoto(input: Uint8Array): Promise<ProcessedLeadPhoto> {
  if (input.byteLength === 0) throw new LeadPhotoError("EMPTY", "The file is empty.");
  if (input.byteLength > LEAD_PHOTO_MAX_BYTES) {
    throw new LeadPhotoError("TOO_LARGE", `Photos can be at most ${LEAD_PHOTO_MAX_BYTES / 1024 / 1024} MB.`);
  }
  if (!sniffImageType(input)) throw new LeadPhotoError("UNSUPPORTED", "Only JPEG, PNG and WebP photos are accepted.");
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  try {
    const base = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "error" }).autoOrient();
    const { data: full, info } = await base
      .clone()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumb = await base.clone().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    const file = `p${randomAlnum(24)}_${info.width}x${info.height}.jpg`;
    return { file, full, thumb, width: info.width, height: info.height };
  } catch (error) {
    throw new LeadPhotoError("CORRUPT", `The photo could not be read: ${(error as Error).message}`);
  }
}
