import "server-only";
import sharp from "sharp";
import { db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import { getStorage } from "@/server/media/storage";
import { getEmbedder, toVectorLiteral, type Embedder, type RgbImage } from "./embedder";
import { buildPassage, contentHash, type PassageInput } from "./passage";

/*
 * Indexing: product → embeddings (worker side; jobs in ./jobs.ts).
 *
 *   text   buildPassage() of title, category path, facet values, tags, SKU, specs, description
 *   image  the main photo (first image by sortOrder), card variant (800w) when processed
 *
 * Idempotent and cheap to repeat: each row stores contentHash = sha256(model + input); unchanged
 * products are only "touched" (updatedAt), never re-embedded. All products are indexed whatever their
 * status (a draft is searchable the moment it is published); visibility is applied at query time.
 */

export const EMBED_BATCH = 16;
/** SigLIP input size; resizing here (squash, like the SigLIP processor) keeps decoded images small. */
const IMAGE_SIZE = 224;

type ProductRow = {
  id: string;
  tenantId: string;
  title: string;
  sku: string | null;
  description: string | null;
  specifications: Prisma.JsonValue;
  categoryId: string | null;
};

type ImageRow = { productId: string; id: string; storageKey: string; variants: Prisma.JsonValue };

type Existing = { productId: string; kind: "text" | "image"; contentHash: string; model: string };

export type IndexResult = { products: number; textEmbedded: number; imageEmbedded: number; imageRemoved: number; skipped: number; failed: number };

function specs(value: Prisma.JsonValue): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return [];
    const { label, value: v } = s as Record<string, unknown>;
    return typeof label === "string" && typeof v === "string" && label.trim() && v.trim() ? [{ label: label.trim(), value: v.trim() }] : [];
  });
}

/** Passage inputs for products of one tenant (batched reads; tenant-scoped). */
export async function loadPassageInputs(tenantId: string, productIds: string[]): Promise<Map<string, PassageInput>> {
  if (!productIds.length) return new Map();
  const [products, categories, facetLinks, tagLinks] = await Promise.all([
    db.product.findMany({
      where: { tenantId, id: { in: productIds } },
      select: { id: true, tenantId: true, title: true, sku: true, description: true, specifications: true, categoryId: true },
    }) as Promise<ProductRow[]>,
    db.category.findMany({ where: { tenantId }, select: { id: true, parentId: true, title: true } }),
    db.productFacetValue.findMany({
      where: { tenantId, productId: { in: productIds } },
      select: { productId: true, facetValue: { select: { name: true, sortOrder: true, facet: { select: { name: true, sortOrder: true } } } } },
    }),
    db.productTag.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, tag: { select: { name: true } } } }),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const pathOf = (id: string | null): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur = id ? catById.get(id) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift(cur.title);
      cur = cur.parentId ? catById.get(cur.parentId) : undefined;
    }
    return out;
  };
  const facetsBy = new Map<string, { facet: string; value: string; order: number }[]>();
  for (const l of facetLinks) {
    const list = facetsBy.get(l.productId) ?? [];
    list.push({ facet: l.facetValue.facet.name, value: l.facetValue.name, order: l.facetValue.facet.sortOrder * 10_000 + l.facetValue.sortOrder });
    facetsBy.set(l.productId, list);
  }
  const tagsBy = new Map<string, string[]>();
  for (const l of tagLinks) tagsBy.set(l.productId, [...(tagsBy.get(l.productId) ?? []), l.tag.name]);
  return new Map(
    products.map((p) => [
      p.id,
      {
        title: p.title,
        sku: p.sku,
        description: p.description,
        categoryPath: pathOf(p.categoryId),
        facets: (facetsBy.get(p.id) ?? []).sort((a, b) => a.order - b.order).map(({ facet, value }) => ({ facet, value })),
        tags: (tagsBy.get(p.id) ?? []).sort(),
        specifications: specs(p.specifications),
      },
    ]),
  );
}

/** Main photo per product (first by sortOrder, then createdAt). */
async function mainImages(tenantId: string, productIds: string[]): Promise<Map<string, ImageRow>> {
  if (!productIds.length) return new Map();
  const rows = await db.$queryRaw<ImageRow[]>`
    SELECT DISTINCT ON (i."productId") i."productId", i.id, i."storageKey", i.variants
    FROM product_images i
    WHERE i."tenantId" = ${tenantId} AND i."productId" = ANY(${productIds}::text[])
    ORDER BY i."productId", i."sortOrder" ASC, i."createdAt" ASC`;
  return new Map(rows.map((r) => [r.productId, r]));
}

/** Storage key of the variant to embed: the processed card (800w WebP) or the original. */
function imageSourceKey(img: ImageRow): string {
  const v = img.variants;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const card = (v as Record<string, { key?: unknown }>).card;
    if (card && typeof card.key === "string") return card.key;
  }
  return img.storageKey;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Decodes + resizes an image to SigLIP's input (224×224 RGB, squashed like its processor). */
export async function toRgb(bytes: Uint8Array, size = IMAGE_SIZE): Promise<RgbImage> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
    .rotate()
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

async function upsertEmbedding(tenantId: string, productId: string, kind: "text" | "image", model: string, vector: number[], hash: string) {
  await db.$executeRaw`
    INSERT INTO product_embeddings ("tenantId", "productId", kind, model, dim, embedding, "contentHash", "updatedAt")
    VALUES (${tenantId}, ${productId}, ${kind}::embedding_kind, ${model}, ${vector.length}, ${toVectorLiteral(vector)}::vector, ${hash}, now())
    ON CONFLICT ("productId", kind) DO UPDATE
      SET model = EXCLUDED.model, dim = EXCLUDED.dim, embedding = EXCLUDED.embedding,
          "contentHash" = EXCLUDED."contentHash", "updatedAt" = now()`;
}

/**
 * (Re)embeds the given products of one tenant where their content changed (or `force`). Products of
 * other tenants / unknown ids are ignored. Image failures (missing file, undecodable) are logged
 * and skipped; the text embedding still happens.
 */
export async function indexProducts(
  tenantId: string,
  productIds: string[],
  opts: { embedder?: Embedder; force?: boolean } = {},
): Promise<IndexResult> {
  const result: IndexResult = { products: 0, textEmbedded: 0, imageEmbedded: 0, imageRemoved: 0, skipped: 0, failed: 0 };
  const ids = [...new Set(productIds)];
  if (!ids.length) return result;
  const embedder = opts.embedder ?? (await getEmbedder());
  if (!embedder) throw new Error("search: no embedder available (SEARCH_SEMANTIC=off?)");

  const [inputs, images, existingRows] = await Promise.all([
    loadPassageInputs(tenantId, ids),
    mainImages(tenantId, ids),
    db.$queryRaw<Existing[]>`
      SELECT "productId", kind::text AS kind, "contentHash", model FROM product_embeddings
      WHERE "tenantId" = ${tenantId} AND "productId" = ANY(${ids}::text[])`,
  ]);
  const existing = new Map(existingRows.map((r) => [`${r.productId}:${r.kind}`, r]));
  result.products = inputs.size;

  // Text: embed changed passages in batches.
  const todo: { id: string; passage: string; hash: string }[] = [];
  for (const [id, input] of inputs) {
    const passage = buildPassage(input);
    const hash = contentHash(embedder.textModel, passage);
    if (!opts.force && existing.get(`${id}:text`)?.contentHash === hash) {
      result.skipped += 1;
      continue;
    }
    todo.push({ id, passage, hash });
  }
  if (todo.length) await embedder.load("text", { timeoutMs: 60_000 });
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH);
    const vectors = await embedder.embedPassages(batch.map((b) => b.passage));
    for (let k = 0; k < batch.length; k++) await upsertEmbedding(tenantId, batch[k].id, "text", embedder.textModel, vectors[k], batch[k].hash);
    result.textEmbedded += batch.length;
  }

  // Image: the main photo; removed when the product has none any more.
  for (const id of inputs.keys()) {
    const img = images.get(id);
    const prev = existing.get(`${id}:image`);
    if (!img) {
      if (prev) {
        await db.$executeRaw`DELETE FROM product_embeddings WHERE "productId" = ${id} AND kind = 'image'`;
        result.imageRemoved += 1;
      }
      continue;
    }
    const key = imageSourceKey(img);
    const hash = contentHash(embedder.imageModel, `${img.id}\u0000${key}`);
    if (!opts.force && prev?.contentHash === hash) continue;
    try {
      const obj = await getStorage().get(key);
      if (!obj) throw new Error(`image file missing: ${key}`);
      // Decoded + shrunk here (224×224 RGB, ~150 kB) so only pixels travel to the embedder service.
      const vector = await embedder.embedImage(await toRgb(await readAll(obj.body)), { timeoutMs: 30_000 });
      await upsertEmbedding(tenantId, id, "image", embedder.imageModel, vector, hash);
      result.imageEmbedded += 1;
    } catch (err) {
      result.failed += 1;
      console.warn(`[search] image embedding failed for product ${id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Mark everything looked at as current (the safety-net scan compares with products.updatedAt).
  await db.$executeRaw`
    UPDATE product_embeddings SET "updatedAt" = now()
    WHERE "tenantId" = ${tenantId} AND "productId" = ANY(${[...inputs.keys()]}::text[]) AND "updatedAt" < now() - interval '1 second'`;
  return result;
}

/** Ids of a tenant's products in stable order, paged (reindex). */
async function productIdPage(tenantId: string, after: string | null, limit: number): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
    take: limit,
  });
  return rows.map((r) => r.id);
}

export type ReindexProgress = { done: number; total: number } & IndexResult;

/**
 * Re-checks the products of a tenant in id order (only changed ones are embedded; `force` re-embeds
 * all). Time-boxed: stops after `deadline` (epoch ms) and returns the cursor to continue from, so
 * the job can re-enqueue itself (graceful worker shutdowns, job expiry).
 */
export async function reindexTenant(
  tenantId: string,
  opts: {
    embedder?: Embedder;
    force?: boolean;
    batchSize?: number;
    after?: string | null;
    deadline?: number;
    onProgress?: (p: ReindexProgress & { cursor: string | null }) => void | Promise<void>;
    signal?: AbortSignal;
  } = {},
): Promise<ReindexProgress & { cursor: string | null; finished: boolean }> {
  const total = await db.product.count({ where: { tenantId } });
  const progress: ReindexProgress = { done: 0, total, products: 0, textEmbedded: 0, imageEmbedded: 0, imageRemoved: 0, skipped: 0, failed: 0 };
  let after: string | null = opts.after ?? null;
  const size = opts.batchSize ?? 64;
  for (;;) {
    if (opts.signal?.aborted || (opts.deadline && Date.now() > opts.deadline)) return { ...progress, cursor: after, finished: false };
    const ids = await productIdPage(tenantId, after, size);
    if (!ids.length) break;
    const r = await indexProducts(tenantId, ids, { embedder: opts.embedder, force: opts.force });
    for (const k of ["products", "textEmbedded", "imageEmbedded", "imageRemoved", "skipped", "failed"] as const) progress[k] += r[k];
    progress.done += ids.length;
    after = ids[ids.length - 1];
    await opts.onProgress?.({ ...progress, cursor: after });
  }
  // Rows of deleted products go with the FK cascade; nothing else to prune.
  return { ...progress, cursor: null, finished: true };
}

/**
 * Safety net (cron): products without a text embedding, edited after their embedding, embedded with
 * another model, or with a photo added since the last pass but no image embedding. Grouped per tenant.
 */
export async function findOutdated(textModel: string, limit = 500): Promise<{ tenantId: string; productIds: string[] }[]> {
  const rows = await db.$queryRaw<{ tenantId: string; id: string }[]>`
    SELECT p."tenantId", p.id
    FROM products p
    LEFT JOIN product_embeddings t ON t."productId" = p.id AND t.kind = 'text'
    LEFT JOIN product_embeddings i ON i."productId" = p.id AND i.kind = 'image'
    WHERE t."productId" IS NULL
       OR t."updatedAt" < p."updatedAt"
       OR t.model <> ${textModel}
       -- a photo added after the last indexing pass (a photo that failed to embed is not retried forever)
       OR (i."productId" IS NULL AND EXISTS (SELECT 1 FROM product_images pi WHERE pi."productId" = p.id AND pi."createdAt" > t."updatedAt"))
    ORDER BY p."updatedAt" DESC
    LIMIT ${limit}`;
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.tenantId, [...(by.get(r.tenantId) ?? []), r.id]);
  return [...by].map(([tenantId, productIds]) => ({ tenantId, productIds }));
}

export type IndexStatus = {
  products: number;
  textIndexed: number;
  withPhoto: number;
  imageIndexed: number;
  /** Products whose text embedding is missing, older than the product, or from another model. */
  outdated: number;
  textModel: string;
  imageModel: string;
};

/** Index coverage of one tenant (admin card). */
export async function indexStatus(tenantId: string, models: { text: string; image: string }): Promise<IndexStatus> {
  const [row] = await db.$queryRaw<{ products: number; text: number; photo: number; image: number; outdated: number }[]>`
    SELECT
      count(*)::int AS products,
      count(t."productId") FILTER (WHERE t.model = ${models.text})::int AS text,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM product_images pi WHERE pi."productId" = p.id))::int AS photo,
      count(i."productId") FILTER (WHERE i.model = ${models.image})::int AS image,
      count(*) FILTER (WHERE t."productId" IS NULL OR t."updatedAt" < p."updatedAt" OR t.model <> ${models.text})::int AS outdated
    FROM products p
    LEFT JOIN product_embeddings t ON t."productId" = p.id AND t.kind = 'text'
    LEFT JOIN product_embeddings i ON i."productId" = p.id AND i.kind = 'image'
    WHERE p."tenantId" = ${tenantId}`;
  return {
    products: row?.products ?? 0,
    textIndexed: row?.text ?? 0,
    withPhoto: row?.photo ?? 0,
    imageIndexed: row?.image ?? 0,
    outdated: row?.outdated ?? 0,
    textModel: models.text,
    imageModel: models.image,
  };
}
