import type { PrismaClient } from "../../../src/generated/prisma/client";
import { processImage } from "../../../src/server/media/images";
import { storeProcessedImage } from "../../../src/server/media/store";
import { assertValidKey, type StorageDriver } from "../../../src/server/media/storage";
import { json, type EtlContext } from "../context";
import type { ImageDownloader } from "../images";
import type { EtlReport } from "../report";
import { decodePhotoIds } from "../transforms/json";

/** Storage key of a not-yet-downloaded legacy photo (no file exists until the download run). */
export function placeholderKey(tenantId: string, productId: string, cloudflareId: string): string {
  const key = `${tenantId}/products/${productId}/cf-${cloudflareId.replace(/[^A-Za-z0-9._-]/g, "-")}.pending`;
  assertValidKey(key);
  return key;
}

/**
 * `products.photos` (double-encoded JSON list of Cloudflare ids) → ProductImage rows in photo order
 * (sortOrder 0 = cover). New photos are recorded as placeholders (`legacyCloudflareId`, processedAt
 * null); downloading happens in `downloadPendingImages` after the step commits.
 */
export async function imagesStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const rows = await ctx.legacy.read("products");
  const products = new Map(
    (
      await tx.product.findMany({
        where: { tenantId, stockCode: { in: rows.map((r) => r.id) }, legacyData: { path: ["etl"], equals: "concept500" } },
        select: { id: true, stockCode: true, status: true },
      })
    ).map((p) => [p.stockCode, p]),
  );
  const images = await tx.productImage.findMany({
    where: { tenantId, productId: { in: [...products.values()].map((p) => p.id) } },
    select: { id: true, productId: true, legacyCloudflareId: true, sortOrder: true, processedAt: true },
  });
  const byProduct = new Map<string, typeof images>();
  for (const img of images) byProduct.set(img.productId, [...(byProduct.get(img.productId) ?? []), img]);

  let legacyCount = 0;
  const withoutByStatus = new Map<string, number[]>();
  for (const r of rows) {
    const product = products.get(r.id);
    if (!product) continue;
    const decoded = decodePhotoIds(r.photos);
    if (decoded.error) report.warn(`product #${r.id}: photos JSON not parseable (${decoded.error})`);
    if (decoded.invalid.length) report.warn(`product #${r.id}: ${decoded.invalid.length} invalid photo id(s) skipped`);
    legacyCount += decoded.ids.length;
    if (r.photo_count && r.photo_count !== decoded.ids.length) {
      report.note("Foto-aantal wijkt af van photo_count", `product #${r.id}: photo_count ${r.photo_count}, photos ${decoded.ids.length}`);
    }
    if (decoded.ids.length === 0) {
      withoutByStatus.set(product.status, [...(withoutByStatus.get(product.status) ?? []), r.id]);
    }

    const current = byProduct.get(product.id) ?? [];
    const byCf = new Map(current.filter((c) => c.legacyCloudflareId).map((c) => [c.legacyCloudflareId!, c]));
    // Placeholders whose id disappeared from the legacy list are removed; processed images are kept.
    for (const c of current) {
      if (c.legacyCloudflareId && !decoded.ids.includes(c.legacyCloudflareId) && !c.processedAt) {
        await tx.productImage.delete({ where: { id: c.id } });
        report.skip("product images", "niet meer in legacy (placeholder verwijderd)");
      }
    }
    // Images uploaded in Quartermaster (no legacy id) go after the legacy ones.
    const extra = current.filter((c) => !c.legacyCloudflareId).sort((a, b) => a.sortOrder - b.sortOrder);
    for (const [i, cfId] of decoded.ids.entries()) {
      const cur = byCf.get(cfId);
      if (cur) {
        if (cur.sortOrder !== i) {
          await tx.productImage.update({ where: { id: cur.id }, data: { sortOrder: i } });
          report.updated("product images");
        } else report.unchanged("product images");
      } else {
        await tx.productImage.create({
          data: { tenantId, productId: product.id, storageKey: placeholderKey(tenantId, product.id, cfId), sortOrder: i, legacyCloudflareId: cfId },
        });
        report.created("product images");
      }
    }
    for (const [j, e] of extra.entries()) {
      const want = decoded.ids.length + j;
      if (e.sortOrder !== want) await tx.productImage.update({ where: { id: e.id }, data: { sortOrder: want } });
    }
  }
  report.legacy("product images", legacyCount);
  let withoutPhotos = 0;
  for (const [status, codes] of withoutByStatus) {
    withoutPhotos += codes.length;
    // Shop-visible statuses are listed by id; drafts/archived only counted.
    const listed = ["ACTIVE", "RESERVED", "SOLD"].includes(status);
    report.note("Producten zonder foto's", `${status}: ${codes.length}${listed ? ` — #${codes.join(", #")}` : ""}`);
  }
  if (withoutPhotos) report.warn(`${withoutPhotos} products have no photos in Concept500`);
  const pending = await tx.productImage.count({ where: { tenantId, processedAt: null, legacyCloudflareId: { not: null } } });
  report.meta["Foto's nog te downloaden"] = String(pending);
}

/**
 * Downloads every pending legacy photo of the tenant and stores original + variants like a regular
 * upload (src/server/media). Runs OUTSIDE the step transaction (network + file writes); each image
 * is committed on its own, so an interrupted run resumes where it stopped.
 */
export async function downloadPendingImages(opts: {
  prisma: PrismaClient;
  tenantId: string;
  downloader: ImageDownloader;
  storage: StorageDriver;
  report: EtlReport;
  concurrency?: number;
}) {
  const { prisma, tenantId, downloader, storage, report } = opts;
  const pending = await prisma.productImage.findMany({
    where: { tenantId, processedAt: null, legacyCloudflareId: { not: null } },
    select: { id: true, productId: true, legacyCloudflareId: true, storageKey: true },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
  });
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < pending.length) {
      const img = pending[next++];
      try {
        const file = await downloader.download(img.legacyCloudflareId!);
        const processed = await processImage(file.bytes);
        const storageKey = `${tenantId}/products/${img.productId}/${img.id}.${processed.ext}`;
        assertValidKey(storageKey);
        const manifest = await storeProcessedImage(storage, storageKey, processed);
        await prisma.productImage.update({
          where: { id: img.id },
          data: {
            storageKey,
            originalFilename: `${img.legacyCloudflareId}.${processed.ext}`,
            mimeType: processed.mimeType,
            byteSize: processed.original.bytes,
            width: processed.original.width,
            height: processed.original.height,
            variants: json(manifest),
            processedAt: new Date(),
          },
        });
        done++;
      } catch (err) {
        report.skip("product images (download)", `download/verwerking mislukt: ${(err as Error).message.slice(0, 60)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  report.created("product images (download)", done);
  report.legacy("product images (download)", pending.length);
}
