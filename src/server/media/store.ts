import "server-only";
import type { ProcessedImage } from "./images";
import { VARIANT_NAMES } from "./images";
import type { StorageDriver } from "./storage";

/**
 * Storage layout of processed images (product and content images alike):
 *   original  `{base}.{ext}`              variants  `{base}/{variant}.webp` (+ `{base}/{variant}.avif`)
 *   content images only: `{base}/manifest.json` (no DB row to hold the manifest; never served).
 * Kept free of DB imports so the ETL and seed scripts can use it.
 */

export type ImageVariant = (typeof VARIANT_NAMES)[number] | "original";

export type ManifestEntry = {
  key: string;
  width: number;
  height: number;
  bytes: number;
  dataUrl?: string;
  /** Same width encoded as AVIF (round 3; absent for blur and for images not yet reprocessed). */
  avif?: { key: string; bytes: number };
};
export type VariantManifest = Partial<Record<(typeof VARIANT_NAMES)[number], ManifestEntry>>;

export function stripExt(key: string): string {
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  return dot > slash ? key.slice(0, dot) : key;
}

/** Key of a variant, derived by convention from the original's storageKey. */
export function variantKey(storageKey: string, variant: ImageVariant, format: "webp" | "avif" = "webp"): string {
  if (variant === "original") return storageKey;
  return `${stripExt(storageKey)}/${variant}.${format}`;
}

/**
 * Content (CMS) images have no DB row, so their manifest lives next to the variants as
 * `{base}/manifest.json` (never served: /uploads only serves image extensions).
 */
export function contentManifestKey(storageKey: string): string {
  return `${stripExt(storageKey)}/manifest.json`;
}

/** Total bytes of a manifest (WebP + AVIF variants). */
export function manifestBytes(manifest: VariantManifest): number {
  return Object.values(manifest).reduce((sum, e) => sum + (Number(e?.bytes) || 0) + (Number(e?.avif?.bytes) || 0), 0);
}

/**
 * Writes the original and every variant (WebP + AVIF) of a processed image under `storageKey`'s
 * convention and returns the manifest. Variants first, original last: a present original means a
 * complete set (seed/ETL use it as the "done" marker).
 */
export async function storeProcessedImage(storage: StorageDriver, storageKey: string, processed: ProcessedImage): Promise<VariantManifest> {
  const manifest: VariantManifest = {};
  for (const name of VARIANT_NAMES) {
    const v = processed.variants[name];
    if (!v) continue;
    const key = variantKey(storageKey, name);
    await storage.put(key, v.data, v.mimeType);
    const entry: ManifestEntry = { key, width: v.width, height: v.height, bytes: v.bytes, ...(name === "blur" ? { dataUrl: processed.blurDataUrl } : {}) };
    if (v.avif) {
      const avifKey = variantKey(storageKey, name, "avif");
      await storage.put(avifKey, v.avif.data, v.avif.mimeType);
      entry.avif = { key: avifKey, bytes: v.avif.bytes };
    }
    manifest[name] = entry;
  }
  await storage.put(storageKey, processed.original.data, processed.mimeType);
  return manifest;
}

/** Content images: variants + original + `manifest.json` (width/height of the original, variant manifest). */
export async function storeContentImage(storage: StorageDriver, storageKey: string, processed: ProcessedImage): Promise<VariantManifest> {
  const manifest = await storeProcessedImage(storage, storageKey, processed);
  await writeContentManifest(storage, storageKey, { width: processed.original.width, height: processed.original.height, variants: manifest });
  return manifest;
}

export type ContentManifest = { width: number; height: number; variants: VariantManifest };

export async function writeContentManifest(storage: StorageDriver, storageKey: string, m: ContentManifest): Promise<void> {
  await storage.put(contentManifestKey(storageKey), new TextEncoder().encode(JSON.stringify(m)), "application/json");
  manifestCache.delete(storageKey); // this process re-reads it; other processes re-check missing ones after a minute
}



// ─── Content manifests (read side) ──────────────────────────────────────────

const MANIFEST_CACHE_MAX = 2000;
const MISSING_TTL_MS = 60_000;
const manifestCache = new Map<string, { value: ContentManifest | null; at: number }>();

/**
 * The `manifest.json` of a content image, or null (older uploads before `npm run media:reprocess`, or a
 * key that was never processed). Content keys are immutable (random/hash suffix), so a found manifest is
 * cached in memory for the life of the process; a missing one is re-checked after a minute (the
 * reprocess script may add it).
 */
export async function readContentManifest(storage: StorageDriver, storageKey: string): Promise<ContentManifest | null> {
  const hit = manifestCache.get(storageKey);
  if (hit && (hit.value || Date.now() - hit.at < MISSING_TTL_MS)) return hit.value;
  let value: ContentManifest | null = null;
  try {
    const object = await storage.get(contentManifestKey(storageKey));
    if (object) {
      const parsed = JSON.parse(await new Response(object.body).text()) as ContentManifest;
      if (parsed && typeof parsed === "object" && parsed.variants && typeof parsed.variants === "object") value = parsed;
    }
  } catch {
    value = null; // invalid key or unreadable manifest: render with the conventional variants
  }
  if (manifestCache.size >= MANIFEST_CACHE_MAX) manifestCache.delete(manifestCache.keys().next().value!);
  manifestCache.set(storageKey, { value, at: Date.now() });
  return value;
}
