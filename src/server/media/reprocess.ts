import "server-only";
import sharp from "sharp";
import { MAX_PIXELS, VARIANTS, VARIANT_NAMES, renderVariants, variantApplies, type VariantName } from "./images";
import type { StorageDriver } from "./storage";
import { readContentManifest, stripExt, variantKey, writeContentManifest, type ContentManifest, type ManifestEntry, type VariantManifest } from "./store";

/**
 * Completes stored images to the current variant set (src/server/media/images.ts VARIANTS): adds the
 * missing widths and AVIF files, never touches files that exist (their URLs are cached as immutable,
 * so their bytes must not change). Idempotent — an image that is complete costs one manifest check and
 * no decoding — and resumable: each image is finished (files, then manifest) before the next one.
 * Used by `npm run media:reprocess` (scripts/media/reprocess.ts).
 */

export type Want = Partial<Record<VariantName, { webp: boolean; avif: boolean }>>;

/** Which files of the current set are missing from `manifest` for a source `sourceWidth` px wide. */
export function missingVariants(manifest: VariantManifest, sourceWidth: number): Want {
  const want: Want = {};
  for (const name of VARIANT_NAMES) {
    if (!variantApplies(name, Math.min(sourceWidth, VARIANTS.large.width))) continue;
    const entry = manifest[name];
    const webp = !entry?.key;
    const avif = VARIANTS[name].avif && !entry?.avif?.key;
    if (webp || avif) want[name] = { webp, avif };
  }
  return want;
}

export type CompleteResult = { status: "complete" | "updated" | "missing-original"; files: number; bytes: number; manifest: VariantManifest };

/**
 * Renders the missing variants of one image from its original and returns the merged manifest.
 * `sourceWidth` (the auto-oriented original's width) decides which optional widths apply; when unknown
 * it is read from the file.
 */
export async function completeImage(
  storage: StorageDriver,
  storageKey: string,
  manifest: VariantManifest,
  sourceWidth: number | null,
  opts: { dryRun?: boolean } = {},
): Promise<CompleteResult> {
  let width = sourceWidth;
  let input: Buffer | null = null;
  const load = async () => {
    if (input) return input;
    const object = await storage.get(storageKey);
    if (!object) return null;
    input = Buffer.from(await new Response(object.body).arrayBuffer());
    return input;
  };
  if (!width) {
    const buf = await load();
    if (!buf) return { status: "missing-original", files: 0, bytes: 0, manifest };
    width = await orientedWidth(buf);
  }
  const want = missingVariants(manifest, width);
  const names = Object.keys(want) as VariantName[];
  if (!names.length) return { status: "complete", files: 0, bytes: 0, manifest };
  const files = names.reduce((n, k) => n + (want[k]!.webp ? 1 : 0) + (want[k]!.avif ? 1 : 0), 0);
  if (opts.dryRun) return { status: "updated", files, bytes: 0, manifest };

  const buf = await load();
  if (!buf) return { status: "missing-original", files: 0, bytes: 0, manifest };
  const { variants } = await renderVariants(sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error" }).autoOrient(), want);
  const next: VariantManifest = { ...manifest };
  let bytes = 0;
  let written = 0;
  for (const name of names) {
    const r = variants[name];
    if (!r) continue;
    const entry: ManifestEntry = next[name] ? { ...next[name]! } : ({} as ManifestEntry);
    if (r.webp) {
      const key = variantKey(storageKey, name);
      await storage.put(key, r.webp.data, "image/webp");
      Object.assign(entry, { key, width: r.webp.width, height: r.webp.height, bytes: r.webp.bytes });
      if (name === "blur") entry.dataUrl = `data:image/webp;base64,${r.webp.data.toString("base64")}`;
      bytes += r.webp.bytes;
      written++;
    }
    if (r.avif) {
      const key = variantKey(storageKey, name, "avif");
      await storage.put(key, r.avif.data, "image/avif");
      entry.avif = { key, bytes: r.avif.bytes };
      if (!entry.width) Object.assign(entry, { width: r.avif.width, height: r.avif.height });
      bytes += r.avif.bytes;
      written++;
    }
    next[name] = entry;
  }
  return { status: "updated", files: written, bytes, manifest: next };
}

/** Display width of an image file (EXIF orientation 5–8 swaps width and height). */
async function orientedWidth(buf: Buffer): Promise<number> {
  const meta = await sharp(buf).metadata();
  return ((meta.orientation ?? 1) >= 5 ? meta.height : meta.width) ?? 0;
}

// ─── Content images ──────────────────────────────────────────────────────────

const ORIGINAL = /\.(jpe?g|png|webp|avif)$/i;

/**
 * Content originals of a tenant: `{tenantId}/content/**` image files that have a variant directory
 * next to them (`{base}/card.webp`), i.e. images that went through the pipeline.
 */
export async function listContentOriginals(storage: StorageDriver, tenantId: string): Promise<string[]> {
  if (!storage.list) throw new Error("This storage driver cannot list; content images cannot be reprocessed");
  const out: string[] = [];
  const walk = async (prefix: string) => {
    const entries = await storage.list!(prefix);
    const dirs = new Set(entries.filter((e) => e.kind === "dir").map((e) => e.name));
    for (const e of entries) {
      if (e.kind === "file" && ORIGINAL.test(e.name) && dirs.has(stripExt(e.name)) && (await storage.exists(`${prefix}${stripExt(e.name)}/card.webp`))) {
        out.push(`${prefix}${e.name}`);
      }
    }
    for (const d of dirs) {
      // Variant directories hold no originals; skip them unless they also contain sub-directories.
      if (entries.some((e) => e.kind === "file" && stripExt(e.name) === d)) continue;
      await walk(`${prefix}${d}/`);
    }
  };
  await walk(`${tenantId}/content/`);
  return out.sort();
}

/** Builds a manifest for a content image processed before manifests existed (reads its WebP files). */
async function manifestFromFiles(storage: StorageDriver, storageKey: string): Promise<VariantManifest> {
  const manifest: VariantManifest = {};
  for (const name of VARIANT_NAMES) {
    const key = variantKey(storageKey, name);
    const object = await storage.get(key);
    if (!object) continue;
    const buf = Buffer.from(await new Response(object.body).arrayBuffer());
    const meta = await sharp(buf).metadata();
    const entry: ManifestEntry = { key, width: meta.width ?? 0, height: meta.height ?? 0, bytes: buf.length };
    if (name === "blur") entry.dataUrl = `data:image/webp;base64,${buf.toString("base64")}`;
    const avifKey = variantKey(storageKey, name, "avif");
    const avif = await storage.head(avifKey);
    if (avif) entry.avif = { key: avifKey, bytes: avif.size };
    manifest[name] = entry;
  }
  return manifest;
}

export async function completeContentImage(storage: StorageDriver, storageKey: string, opts: { dryRun?: boolean } = {}): Promise<CompleteResult> {
  const existing = await readContentManifest(storage, storageKey);
  const original = await storage.get(storageKey);
  if (!original) return { status: "missing-original", files: 0, bytes: 0, manifest: existing?.variants ?? {} };
  const buf = Buffer.from(await new Response(original.body).arrayBuffer());
  const meta = await sharp(buf).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const [width, height] = rotated ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
  const base: ContentManifest = existing ?? { width, height, variants: await manifestFromFiles(storage, storageKey) };
  const result = await completeImage(storage, storageKey, base.variants, width, opts);
  if (!opts.dryRun && (result.status === "updated" || !existing)) {
    await writeContentManifest(storage, storageKey, { width: base.width, height: base.height, variants: result.manifest });
    return { ...result, status: "updated" };
  }
  return result;
}
