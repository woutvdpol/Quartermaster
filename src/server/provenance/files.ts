import "server-only";
import sharp from "sharp";
import { MAX_PIXELS, MAX_UPLOAD_BYTES } from "@/server/media/images";

/*
 * Validation / normalisation of uploaded provenance documents.
 *
 *  - The type is detected from the bytes (magic numbers), never from the file name or client MIME.
 *  - PDF: must start with `%PDF-`, at most 20 MB, stored byte-for-byte (we do not rewrite PDFs).
 *  - Images (JPEG / PNG / WebP): re-encoded with sharp — EXIF rotation applied, ALL metadata
 *    stripped (scans from phones carry GPS), long edge capped at 4000 px. Same format out as in.
 *  - Anything else (HEIC, GIF, SVG, Office files, …) is rejected.
 */

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_IMAGE_BYTES = MAX_UPLOAD_BYTES; // 25 MB input
export const MAX_DOCUMENT_IMAGE_EDGE = 4000;

export type DocumentFileType = "pdf" | "jpeg" | "png" | "webp";

export const DOCUMENT_FILE_INFO: Record<DocumentFileType, { ext: string; mime: string }> = {
  pdf: { ext: "pdf", mime: "application/pdf" },
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
};

export class DocumentFileError extends Error {
  constructor(
    public readonly reason: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_FORMAT" | "CORRUPT",
    message: string,
  ) {
    super(message);
  }
}

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

/** Detects the file type from its first bytes; null when it is not an accepted type. */
export function sniffDocumentType(bytes: Uint8Array): DocumentFileType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp"; // RIFF....WEBP
  return null;
}

export type PreparedDocumentFile = { type: DocumentFileType; ext: string; mimeType: string; data: Buffer };

/** Validates one uploaded document and returns the bytes to store. Throws DocumentFileError. */
export async function prepareDocumentFile(input: Uint8Array): Promise<PreparedDocumentFile> {
  if (input.byteLength === 0) throw new DocumentFileError("EMPTY", "File is empty");
  const type = sniffDocumentType(input);
  if (!type) throw new DocumentFileError("UNSUPPORTED_FORMAT", "Only PDF, JPEG, PNG and WebP files are accepted");
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const info = DOCUMENT_FILE_INFO[type];

  if (type === "pdf") {
    if (buffer.byteLength > MAX_PDF_BYTES) throw new DocumentFileError("TOO_LARGE", `PDF exceeds ${MAX_PDF_BYTES / 1024 / 1024} MB`);
    return { type, ext: info.ext, mimeType: info.mime, data: buffer };
  }

  if (buffer.byteLength > MAX_DOCUMENT_IMAGE_BYTES) {
    throw new DocumentFileError("TOO_LARGE", `Image exceeds ${MAX_DOCUMENT_IMAGE_BYTES / 1024 / 1024} MB`);
  }
  try {
    const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
    if (!meta.width || !meta.height) throw new DocumentFileError("CORRUPT", "Image has no dimensions");
    if (meta.width * meta.height > MAX_PIXELS) throw new DocumentFileError("TOO_LARGE", `Image exceeds ${MAX_PIXELS / 1_000_000} megapixels`);
    let pipeline = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .autoOrient()
      .resize({ width: MAX_DOCUMENT_IMAGE_EDGE, height: MAX_DOCUMENT_IMAGE_EDGE, fit: "inside", withoutEnlargement: true });
    // sharp writes no metadata unless asked (withMetadata), so EXIF/GPS/XMP are dropped here.
    pipeline =
      type === "jpeg"
        ? pipeline.jpeg({ quality: 88, mozjpeg: true })
        : type === "png"
          ? pipeline.png({ compressionLevel: 9 })
          : pipeline.webp({ quality: 88 });
    const data = await pipeline.toBuffer();
    return { type, ext: info.ext, mimeType: info.mime, data };
  } catch (error) {
    if (error instanceof DocumentFileError) throw error;
    throw new DocumentFileError("CORRUPT", `Image could not be decoded: ${(error as Error).message}`);
  }
}
