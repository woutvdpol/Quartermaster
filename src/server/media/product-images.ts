import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import type { Prisma } from "@/generated/prisma/client";
import { ImageProcessingError, MAX_UPLOAD_BYTES, VARIANT_NAMES, processImage, type VariantName } from "./images";
import { assertValidKey, getStorage } from "./storage";

/**
 * Product image services. Storage layout (docs/schema.md):
 *   original  `{tenantId}/products/{productId}/{imageId}.{ext}`        (= ProductImage.storageKey)
 *   variants  `{tenantId}/products/{productId}/{imageId}/{variant}.webp`
 * Public URL = `/uploads/{key}` (served by src/app/uploads/[...path]/route.ts).
 *
 * Storage accounting: `byteSize` = bytes of the stored original; each manifest entry carries its
 * own `bytes`. Tenant usage = Σ byteSize + Σ manifest bytes (see tenantStorageUsage).
 */

/** Hard ceiling when the platform setting `photoLimit` is null (= no plan limit). */
export const HARD_MAX_IMAGES_PER_PRODUCT = 100;
export const MAX_FILES_PER_UPLOAD = 50;

export type ImageVariant = VariantName | "original";

export type ManifestEntry = { key: string; width: number; height: number; bytes: number; dataUrl?: string };
export type VariantManifest = Partial<Record<VariantName, ManifestEntry>>;

export type ProductImageDto = {
  id: string;
  productId: string;
  sortOrder: number;
  isCover: boolean;
  alt: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  /** Total bytes on storage (original + variants). */
  totalBytes: number;
  urls: Record<ImageVariant, string>;
  /** Inline LQIP placeholder, null for unprocessed (e.g. not-yet-migrated) images. */
  blurDataUrl: string | null;
};

export type UploadFile = { name: string; type: string; bytes: Uint8Array };

// ─── Keys & URLs ─────────────────────────────────────────────────────────────

export function productImageKey(tenantId: string, productId: string, imageId: string, ext: string): string {
  const key = `${tenantId}/products/${productId}/${imageId}.${ext}`;
  assertValidKey(key);
  return key;
}

/** Key of a variant, derived by convention from the original's storageKey. */
export function variantKey(storageKey: string, variant: ImageVariant): string {
  if (variant === "original") return storageKey;
  return `${stripExt(storageKey)}/${variant}.webp`;
}

/** Public URL of an image (variant) — `/uploads/{key}`. */
export function imageUrl(storageKey: string, variant: ImageVariant = "original"): string {
  return `/uploads/${variantKey(storageKey, variant)}`;
}

function stripExt(key: string): string {
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  return dot > slash ? key.slice(0, dot) : key;
}

function newImageId(): string {
  // cuid-like: leading letter, 96 random bits, safe key charset.
  return `i${randomBytes(12).toString("hex")}`;
}

// ─── DTO ─────────────────────────────────────────────────────────────────────

type ImageRow = Prisma.ProductImageGetPayload<object>;

function parseManifest(value: Prisma.JsonValue | null): VariantManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as unknown as VariantManifest;
}

function toDto(row: ImageRow): ProductImageDto {
  const manifest = parseManifest(row.variants);
  const urls = { original: imageUrl(row.storageKey) } as Record<ImageVariant, string>;
  for (const name of VARIANT_NAMES) {
    urls[name] = manifest[name]?.key ? `/uploads/${manifest[name]!.key}` : imageUrl(row.storageKey, name);
  }
  const variantBytes = Object.values(manifest).reduce((sum, e) => sum + (Number(e?.bytes) || 0), 0);
  return {
    id: row.id,
    productId: row.productId,
    sortOrder: row.sortOrder,
    isCover: row.sortOrder === 0,
    alt: row.alt,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    totalBytes: (row.byteSize ?? 0) + variantBytes,
    urls,
    blurDataUrl: manifest.blur?.dataUrl ?? null,
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

const idSchema = z.string().min(1).max(64);

async function requireProduct(tenantId: string, productId: string, client: Prisma.TransactionClient = db) {
  const product = await client.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } });
  if (!product) throw new ServiceError("NOT_FOUND", "Product not found");
  return product;
}

export async function listProductImages(ctx: ServiceContext, productId: string): Promise<ProductImageDto[]> {
  productId = idSchema.parse(productId);
  await requireProduct(ctx.tenantId, productId);
  const rows = await db.productImage.findMany({
    where: { tenantId: ctx.tenantId, productId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDto);
}

/** Bytes used by all product images of a tenant (originals + variants). */
export async function tenantStorageUsage(tenantId: string, client: Prisma.TransactionClient = db): Promise<number> {
  const [row] = await client.$queryRaw<{ used: bigint | null }[]>`
    SELECT COALESCE(SUM(
      COALESCE(pi."byteSize", 0) + COALESCE((
        SELECT SUM((v.value->>'bytes')::bigint)
        FROM jsonb_each(CASE WHEN jsonb_typeof(pi."variants") = 'object' THEN pi."variants" ELSE '{}'::jsonb END) v
        WHERE jsonb_typeof(v.value) = 'object' AND (v.value->>'bytes') ~ '^[0-9]+$'
      ), 0)
    ), 0)::bigint AS used
    FROM "product_images" pi
    WHERE pi."tenantId" = ${tenantId}`;
  return Number(row?.used ?? 0);
}

async function limitsFor(tenantId: string) {
  const platform = await getSettings(tenantId, "platform");
  return {
    maxImages: Math.min(platform.photoLimit ?? HARD_MAX_IMAGES_PER_PRODUCT, HARD_MAX_IMAGES_PER_PRODUCT),
    quotaBytes: Math.floor(platform.storageQuotaGb * 1024 ** 3),
  };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

const uploadSchema = z
  .array(
    z.object({
      name: z.string().max(255),
      type: z.string().max(100),
      bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0, "File is empty"),
    }),
  )
  .min(1, "No files")
  .max(MAX_FILES_PER_UPLOAD, `At most ${MAX_FILES_PER_UPLOAD} files per upload`);

type Prepared = {
  id: string;
  storageKey: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  manifest: VariantManifest;
  totalBytes: number;
};

/**
 * Validates, processes and stores uploaded images and appends them to the product.
 * Enforces the platform photo limit per product and the tenant storage quota. All-or-nothing:
 * any invalid file rejects the whole batch and nothing is kept.
 */
export async function addProductImages(
  ctx: ServiceContext,
  productId: string,
  files: UploadFile[],
): Promise<ProductImageDto[]> {
  productId = idSchema.parse(productId);
  const parsed = uploadSchema.safeParse(files);
  if (!parsed.success) throw new ServiceError("INVALID", parsed.error.issues[0]?.message ?? "Invalid files", parsed.error.issues);
  const tenantId = ctx.tenantId;

  await requireProduct(tenantId, productId);
  const { maxImages, quotaBytes } = await limitsFor(tenantId);

  // Cheap pre-checks before the expensive processing (re-checked under lock below).
  const existing = await db.productImage.count({ where: { tenantId, productId } });
  if (existing + parsed.data.length > maxImages) {
    throw new ServiceError("CONFLICT", `A product can have at most ${maxImages} photos`, { limit: maxImages, existing });
  }
  if ((await tenantStorageUsage(tenantId)) >= quotaBytes) {
    throw new ServiceError("CONFLICT", "Storage quota exceeded", { quotaBytes });
  }
  for (const file of parsed.data) {
    if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new ServiceError("INVALID", `${file.name}: image exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`, { file: file.name, reason: "TOO_LARGE" });
    }
  }

  const storage = getStorage();
  const prepared: Prepared[] = [];
  const cleanup = async () => {
    await Promise.allSettled(
      prepared.flatMap((p) => [storage.delete(p.storageKey), storage.deletePrefix(`${stripExt(p.storageKey)}/`)]),
    );
  };

  try {
    // Sequential on purpose: bounds memory (a 40 MP decode is ~160 MB of pixels).
    for (const file of parsed.data) {
      let processed;
      try {
        processed = await processImage(file.bytes);
      } catch (error) {
        if (error instanceof ImageProcessingError) {
          throw new ServiceError("INVALID", `${file.name}: ${error.message}`, { file: file.name, reason: error.reason });
        }
        throw error;
      }
      const id = newImageId();
      const storageKey = productImageKey(tenantId, productId, id, processed.ext);
      const entry: Prepared = {
        id,
        storageKey,
        name: file.name,
        mimeType: processed.mimeType,
        width: processed.original.width,
        height: processed.original.height,
        byteSize: processed.original.bytes,
        manifest: {},
        totalBytes: processed.original.bytes,
      };
      prepared.push(entry); // before writing, so a partial write is cleaned up too
      await storage.put(storageKey, processed.original.data, processed.mimeType);
      for (const name of VARIANT_NAMES) {
        const v = processed.variants[name];
        const key = variantKey(storageKey, name);
        await storage.put(key, v.data, v.mimeType);
        entry.manifest[name] = {
          key,
          width: v.width,
          height: v.height,
          bytes: v.bytes,
          ...(name === "blur" ? { dataUrl: processed.blurDataUrl } : {}),
        };
        entry.totalBytes += v.bytes;
      }
    }

    const addedBytes = prepared.reduce((sum, p) => sum + p.totalBytes, 0);
    const now = new Date();
    const rows = await db.$transaction(async (tx) => {
      // Serialise media mutations per tenant so limit/quota checks cannot race.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`media:${tenantId}`}))) l`;
      await requireProduct(tenantId, productId, tx);

      const agg = await tx.productImage.aggregate({
        where: { tenantId, productId },
        _count: { _all: true },
        _max: { sortOrder: true },
      });
      const count = agg._count._all;
      if (count + prepared.length > maxImages) {
        throw new ServiceError("CONFLICT", `A product can have at most ${maxImages} photos`, { limit: maxImages, existing: count });
      }
      const used = await tenantStorageUsage(tenantId, tx);
      if (used + addedBytes > quotaBytes) {
        throw new ServiceError("CONFLICT", "Storage quota exceeded", { quotaBytes, usedBytes: used, requestedBytes: addedBytes });
      }

      const start = count === 0 ? 0 : (agg._max.sortOrder ?? -1) + 1;
      await tx.productImage.createMany({
        data: prepared.map((p, i) => ({
          id: p.id,
          tenantId,
          productId,
          storageKey: p.storageKey,
          originalFilename: p.name || null,
          mimeType: p.mimeType,
          byteSize: p.byteSize,
          width: p.width,
          height: p.height,
          sortOrder: start + i,
          variants: p.manifest as Prisma.InputJsonValue,
          processedAt: now,
        })),
      });
      return tx.productImage.findMany({
        where: { id: { in: prepared.map((p) => p.id) } },
        orderBy: { sortOrder: "asc" },
      });
    });

    await audit({
      action: "product.images.added",
      tenantId,
      actorId: ctx.actor.id,
      entity: "Product",
      entityId: productId,
      data: { imageIds: rows.map((r) => r.id), bytes: addedBytes },
    });
    return rows.map(toDto);
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Sets the image order; `orderedIds` must contain every image of the product exactly once. First = cover. */
export async function reorderProductImages(
  ctx: ServiceContext,
  productId: string,
  orderedIds: string[],
): Promise<ProductImageDto[]> {
  productId = idSchema.parse(productId);
  const ids = z.array(idSchema).max(HARD_MAX_IMAGES_PER_PRODUCT * 2).parse(orderedIds);
  const tenantId = ctx.tenantId;

  const rows = await db.$transaction(async (tx) => {
    await requireProduct(tenantId, productId, tx);
    const current = await tx.productImage.findMany({ where: { tenantId, productId }, select: { id: true } });
    const known = new Set(current.map((r) => r.id));
    if (new Set(ids).size !== ids.length || ids.length !== known.size || !ids.every((id) => known.has(id))) {
      throw new ServiceError("INVALID", "Order must list every image of the product exactly once");
    }
    for (const [index, id] of ids.entries()) {
      await tx.productImage.update({ where: { id }, data: { sortOrder: index } });
    }
    return tx.productImage.findMany({ where: { tenantId, productId }, orderBy: { sortOrder: "asc" } });
  });

  await audit({
    action: "product.images.reordered",
    tenantId,
    actorId: ctx.actor.id,
    entity: "Product",
    entityId: productId,
    data: { order: ids },
  });
  return rows.map(toDto);
}

export async function updateImageAlt(ctx: ServiceContext, imageId: string, alt: string | null): Promise<ProductImageDto> {
  imageId = idSchema.parse(imageId);
  const value = z.string().trim().max(250).nullable().parse(alt) || null;
  const image = await db.productImage.findFirst({ where: { id: imageId, tenantId: ctx.tenantId } });
  if (!image) throw new ServiceError("NOT_FOUND", "Image not found");
  const updated = await db.productImage.update({ where: { id: image.id }, data: { alt: value } });
  await audit({
    action: "product.image.alt_updated",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "ProductImage",
    entityId: image.id,
    data: { productId: image.productId },
  });
  return toDto(updated);
}

/** Deletes the row, compacts the order (next image becomes cover if needed), then removes the files. */
export async function deleteProductImage(ctx: ServiceContext, imageId: string): Promise<void> {
  imageId = idSchema.parse(imageId);
  const tenantId = ctx.tenantId;

  const image = await db.$transaction(async (tx) => {
    const found = await tx.productImage.findFirst({ where: { id: imageId, tenantId } });
    if (!found) throw new ServiceError("NOT_FOUND", "Image not found");
    await tx.productImage.delete({ where: { id: found.id } });
    const rest = await tx.productImage.findMany({
      where: { tenantId, productId: found.productId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, sortOrder: true },
    });
    for (const [index, row] of rest.entries()) {
      if (row.sortOrder !== index) await tx.productImage.update({ where: { id: row.id }, data: { sortOrder: index } });
    }
    return found;
  });

  // Files after commit: an orphaned file is harmless, a row pointing at nothing is not.
  await removeImageFiles(image.storageKey);
  await audit({
    action: "product.image.deleted",
    tenantId,
    actorId: ctx.actor.id,
    entity: "ProductImage",
    entityId: image.id,
    data: { productId: image.productId, storageKey: image.storageKey },
  });
}

/**
 * Removes every stored file of a product (call after hard-deleting a product; the DB rows are
 * removed by the cascade). Does not touch the database.
 */
export async function deleteProductMedia(ctx: ServiceContext, productId: string): Promise<void> {
  productId = idSchema.parse(productId);
  const prefix = `${ctx.tenantId}/products/${productId}/`;
  await getStorage().deletePrefix(prefix);
}

async function removeImageFiles(storageKey: string) {
  const storage = getStorage();
  const results = await Promise.allSettled([storage.delete(storageKey), storage.deletePrefix(`${stripExt(storageKey)}/`)]);
  for (const r of results) {
    if (r.status === "rejected") console.error(`[media] could not delete files for ${storageKey}`, r.reason);
  }
}
