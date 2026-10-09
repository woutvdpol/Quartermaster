import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import type { ProductStatus } from "@/generated/prisma/enums";
import { ServiceError, type ServiceContext } from "@/server/context";
import { getStorage } from "@/server/media/storage";
import { variantKey } from "@/server/media/store";
import { getEmbedder, type Embedder, type RgbImage } from "@/server/search/embedder";
import { toRgb } from "@/server/search/indexing";
import { vectorSearch } from "@/server/search/retrieval";
import { CLOSE, selectCandidates, type DuplicateHit, type SimilarityBand } from "./bands";

/*
 * Duplicate photo check (docs/duplicate-check.md). After staff upload photos to a product, the
 * photos are embedded with the photo model of smart search (SigLIP 2, embedder service) and
 * compared with the main-photo vectors of the tenant's other products — stock, drafts and the sold
 * archive alike (product_embeddings, kind "image"). Read-only and best effort: when the embedder
 * is off, down, cold or slower than the time budget, the answer is "no candidates" — the upload
 * itself is never blocked or delayed (it has already been saved when this runs).
 */

/** Total time budget for one check (embedding + kNN). */
export const CHECK_TIMEOUT_MS = 2000;
/** Only the first few photos of an upload are compared (bounded cost per check). */
export const MAX_CHECKED_IMAGES = 4;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export type DuplicateCandidate = {
  productId: string;
  stockCode: number;
  title: string;
  status: ProductStatus;
  soldAt: Date | null;
  /** Cover thumbnail URL, null without photos. */
  thumbUrl: string | null;
  score: number;
  band: SimilarityBand;
  /** Already linked as this product's earlier listing. */
  isPrevious: boolean;
};

export type DuplicateCheckResult = {
  /** "ok": compared (candidates may be empty). Otherwise skipped quietly, candidates empty. */
  state: "ok" | "unavailable" | "timeout" | "no_images";
  candidates: DuplicateCandidate[];
};

const inputSchema = z
  .object({
    productId: z.string().min(1).max(64).optional(),
    imageIds: z.array(z.string().min(1).max(64)).max(100).optional(),
    imageBuffers: z.array(z.instanceof(Uint8Array)).max(100).optional(),
    timeoutMs: z.number().int().min(50).max(10_000).optional(),
  })
  .refine((v) => !!(v.imageIds?.length || v.imageBuffers?.length), { message: "imageIds or imageBuffers required" });

export type CheckDuplicatesInput = z.input<typeof inputSchema> & { embedder?: Embedder | null };

const EMPTY = (state: DuplicateCheckResult["state"]): DuplicateCheckResult => ({ state, candidates: [] });

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

/** The processed card variant (800w, what indexing embeds) or the original. */
function sourceKey(img: { storageKey: string; variants: Prisma.JsonValue }): string {
  const v = img.variants;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const card = (v as Record<string, { key?: unknown }>).card;
    if (card && typeof card.key === "string") return card.key;
  }
  return img.storageKey;
}

function thumbOf(img: { storageKey: string; variants: Prisma.JsonValue } | undefined): string | null {
  if (!img) return null;
  const v = img.variants;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const thumb = (v as Record<string, { key?: unknown }>).thumb;
    if (thumb && typeof thumb.key === "string") return `/uploads/${thumb.key}`;
  }
  return `/uploads/${variantKey(img.storageKey, "thumb")}`;
}

/** Uploaded photos of this tenant (optionally of one product), decoded to the model input. */
async function loadImages(ctx: ServiceContext, input: { productId?: string; imageIds?: string[]; imageBuffers?: Uint8Array[] }): Promise<RgbImage[]> {
  const out: Promise<RgbImage | null>[] = [];
  for (const bytes of (input.imageBuffers ?? []).slice(0, MAX_CHECKED_IMAGES)) {
    if (bytes.byteLength > MAX_INPUT_BYTES) continue;
    out.push(toRgb(bytes).catch(() => null));
  }
  const room = MAX_CHECKED_IMAGES - out.length;
  if (input.imageIds?.length && room > 0) {
    const rows = await db.productImage.findMany({
      where: { tenantId: ctx.tenantId, id: { in: input.imageIds }, ...(input.productId ? { productId: input.productId } : {}) },
      select: { id: true, storageKey: true, variants: true },
    });
    const order = new Map(input.imageIds.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    for (const img of rows.slice(0, room)) {
      out.push(
        (async () => {
          const obj = (await getStorage().get(sourceKey(img))) ?? (await getStorage().get(img.storageKey));
          return obj ? toRgb(await readAll(obj.body)) : null;
        })().catch(() => null),
      );
    }
  }
  return (await Promise.all(out)).filter((x): x is RgbImage => x !== null);
}

class Timeout extends Error {}

/**
 * Up to three products of the same tenant whose main photo looks like the given photos
 * (`imageIds`: stored ProductImage ids, or `imageBuffers`: raw JPEG/PNG/WebP bytes), excluding
 * `productId` itself. Never throws for an unavailable embedder or a timeout — returns no
 * candidates with the reason in `state`. Throws ServiceError for invalid input / unknown product.
 */
export async function checkDuplicates(ctx: ServiceContext, input: CheckDuplicatesInput): Promise<DuplicateCheckResult> {
  const parsed = inputSchema.safeParse({ productId: input.productId, imageIds: input.imageIds, imageBuffers: input.imageBuffers, timeoutMs: input.timeoutMs });
  if (!parsed.success) throw new ServiceError("INVALID", parsed.error.issues[0]?.message ?? "Invalid input");
  const { productId, imageIds, imageBuffers } = parsed.data;
  const timeoutMs = parsed.data.timeoutMs ?? CHECK_TIMEOUT_MS;

  let previousProductId: string | null = null;
  if (productId) {
    const p = await db.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId }, select: { previousProductId: true } });
    if (!p) throw new ServiceError("NOT_FOUND", "Product not found");
    previousProductId = p.previousProductId;
  }

  const embedder = input.embedder !== undefined ? input.embedder : await getEmbedder();
  if (!embedder) return EMPTY("unavailable");
  if (embedder.status("image") !== "ready") {
    embedder.warm("image");
    return EMPTY("unavailable");
  }

  const deadline = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout()), timeoutMs);
  });

  const work = async (): Promise<DuplicateCheckResult> => {
    const images = await loadImages(ctx, { productId, imageIds, imageBuffers });
    if (!images.length) return EMPTY("no_images");
    const vectors = await Promise.all(images.map((img) => embedder.embedImage(img, { timeoutMs: Math.max(50, deadline - Date.now()) })));
    const where = Prisma.sql`p."tenantId" = ${ctx.tenantId}`;
    const lists = await Promise.all(
      vectors.map((v) => vectorSearch(ctx.tenantId, where, v, { kind: "image", dim: embedder.imageDim, limit: 10, minSimilarity: CLOSE, excludeId: productId })),
    );
    const ids = [...new Set(lists.flat().map((h) => h.id))];
    if (!ids.length) return EMPTY("ok");
    const products = await db.product.findMany({
      where: { tenantId: ctx.tenantId, id: { in: ids } },
      select: {
        id: true,
        tenantId: true,
        stockCode: true,
        title: true,
        status: true,
        soldAt: true,
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true, variants: true } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const hits: DuplicateHit[] = lists.flat().flatMap((h) => {
      const p = byId.get(h.id);
      return p ? [{ productId: p.id, tenantId: p.tenantId, status: p.status, score: h.score }] : [];
    });
    const selected = selectCandidates(hits, { tenantId: ctx.tenantId, excludeProductId: productId });
    return {
      state: "ok",
      candidates: selected.map((c) => {
        const p = byId.get(c.productId)!;
        return {
          productId: p.id,
          stockCode: p.stockCode,
          title: p.title,
          status: p.status,
          soldAt: p.soldAt,
          thumbUrl: thumbOf(p.images[0]),
          score: Math.round(c.score * 1000) / 1000,
          band: c.band,
          isPrevious: p.id === previousProductId,
        };
      }),
    };
  };

  try {
    return await Promise.race([work(), expired]);
  } catch (err) {
    if (err instanceof Timeout) return EMPTY("timeout");
    // Embedder errors (down, slow, refused) and storage hiccups: skip quietly, never block uploads.
    console.warn("[duplicates] check skipped:", err instanceof Error ? err.message : err);
    return EMPTY("unavailable");
  } finally {
    clearTimeout(timer);
  }
}
