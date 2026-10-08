import "server-only";
import { sniffImageType } from "@/server/leads/sniff";
import type { RgbImage } from "./embedder";
import { toRgb } from "./indexing";

/*
 * Photo search input ("lijkt hierop" upload / paste / camera). The photo is only ever held in memory:
 * validated (size, magic bytes — never the client's MIME type or file name), decoded and shrunk to
 * the model input (224×224 RGB) by sharp, then dropped. Nothing is written to storage or logged.
 */

export const SEARCH_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export class SearchImageError extends Error {
  constructor(
    readonly code: "too_large" | "unsupported" | "undecodable",
    message: string,
  ) {
    super(message);
    this.name = "SearchImageError";
  }
}

/** Validates and decodes an uploaded photo. JPEG, PNG and WebP (phone cameras deliver JPEG). */
export async function decodeSearchImage(bytes: Uint8Array): Promise<RgbImage> {
  if (bytes.byteLength > SEARCH_IMAGE_MAX_BYTES) throw new SearchImageError("too_large", "The photo is too large (max 10 MB).");
  if (!sniffImageType(bytes)) throw new SearchImageError("unsupported", "Use a JPEG, PNG or WebP photo.");
  try {
    return await toRgb(bytes);
  } catch {
    throw new SearchImageError("undecodable", "This photo could not be read.");
  }
}
