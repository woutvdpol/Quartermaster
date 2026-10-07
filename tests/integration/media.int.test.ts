import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { ServiceError, type ServiceContext } from "@/server/context";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import {
  addProductImages,
  deleteProductImage,
  deleteProductMedia,
  imageUrl,
  listProductImages,
  reorderProductImages,
  tenantStorageUsage,
  updateImageAlt,
  variantKey,
} from "@/server/media/product-images";
import { createTenantContext, resetDb } from "./helpers";

let root: string;
let driver: LocalDriver;
let stock = 50000;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-media-int-"));
  driver = new LocalDriver(root);
  setStorageForTests(driver);
});
afterAll(async () => {
  setStorageForTests(null);
  await fs.rm(root, { recursive: true, force: true });
});
beforeEach(resetDb);

async function createProduct(ctx: ServiceContext) {
  stock += 1;
  return db.product.create({
    data: { tenantId: ctx.tenantId, stockCode: stock, slug: `p-${stock}`, title: `Product ${stock}`, price: 1000 },
  });
}

async function jpeg(width = 1200, height = 800) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .jpeg()
    .toBuffer();
  return { name: `photo-${width}.jpg`, type: "image/jpeg", bytes: new Uint8Array(bytes) };
}

async function setPlatform(ctx: ServiceContext, data: Prisma.InputJsonObject) {
  await db.setting.create({ data: { tenantId: ctx.tenantId, group: "platform", data } });
}

const filesUnder = async (dir: string): Promise<string[]> =>
  (await fs.readdir(path.join(root, dir), { recursive: true }).catch(() => [] as string[])).filter((f) => /\.\w+$/.test(f));

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("product images", () => {
  it("adds images: stores original + variants, rows, manifest, audit", async () => {
    const ctx = await createTenantContext();
    const product = await createProduct(ctx);

    const added = await addProductImages(ctx, product.id, [await jpeg(), await jpeg(400, 300)]);
    expect(added).toHaveLength(2);
    expect(added.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(added[0].isCover).toBe(true);
    expect(added[0].urls.thumb).toBe(`/uploads/${ctx.tenantId}/products/${product.id}/${added[0].id}/thumb.webp`);
    expect(added[0].urls.original).toBe(`/uploads/${ctx.tenantId}/products/${product.id}/${added[0].id}.jpg`);
    expect(added[0].blurDataUrl).toMatch(/^data:image\/webp;base64,/);

    const row = await db.productImage.findUniqueOrThrow({ where: { id: added[0].id } });
    expect(row.storageKey).toBe(`${ctx.tenantId}/products/${product.id}/${row.id}.jpg`);
    expect([row.width, row.height, row.mimeType, row.originalFilename]).toEqual([1200, 800, "image/jpeg", "photo-1200.jpg"]);
    expect(row.processedAt).not.toBeNull();
    expect(row.variants).toMatchObject({
      thumb: { key: variantKey(row.storageKey, "thumb"), width: 320, height: 213 },
      card: { width: 800 },
      large: { width: 1200 },
      blur: { width: 24 },
    });
    for (const v of ["original", "thumb", "card", "large", "blur"] as const) {
      expect(await driver.exists(variantKey(row.storageKey, v))).toBe(true);
    }
    expect(imageUrl(row.storageKey, "card")).toBe(added[0].urls.card);

    const usage = await tenantStorageUsage(ctx.tenantId);
    expect(usage).toBe(added[0].totalBytes + added[1].totalBytes);
    expect(await db.auditLog.count({ where: { action: "product.images.added", tenantId: ctx.tenantId } })).toBe(1);

    // Appends after existing images.
    const more = await addProductImages(ctx, product.id, [await jpeg(300, 300)]);
    expect(more[0].sortOrder).toBe(2);
  });

  it("rejects products of another tenant and leaves no files", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const productB = await createProduct(b);

    await expectServiceError(addProductImages(a, productB.id, [await jpeg()]), "NOT_FOUND");
    await expectServiceError(listProductImages(a, productB.id), "NOT_FOUND");
    expect(await filesUnder(a.tenantId)).toEqual([]);
    expect(await filesUnder(b.tenantId)).toEqual([]);

    const [img] = await addProductImages(b, productB.id, [await jpeg()]);
    await expectServiceError(deleteProductImage(a, img.id), "NOT_FOUND");
    await expectServiceError(updateImageAlt(a, img.id, "x"), "NOT_FOUND");
    await expectServiceError(reorderProductImages(a, productB.id, [img.id]), "NOT_FOUND");
    expect(await db.productImage.count()).toBe(1);
  });

  it("rejects invalid files atomically", async () => {
    const ctx = await createTenantContext();
    const product = await createProduct(ctx);
    const bogus = { name: "evil.jpg", type: "image/jpeg", bytes: new TextEncoder().encode("<html>not an image</html>") };

    await expect(addProductImages(ctx, product.id, [await jpeg(), bogus])).rejects.toMatchObject({
      code: "INVALID",
      details: { file: "evil.jpg", reason: "UNSUPPORTED_FORMAT" },
    });
    expect(await db.productImage.count()).toBe(0);
    expect(await filesUnder(ctx.tenantId)).toEqual([]);
    await expectServiceError(addProductImages(ctx, product.id, []), "INVALID");
  });

  it("enforces the platform photo limit per product", async () => {
    const ctx = await createTenantContext();
    await setPlatform(ctx, { photoLimit: 2 });
    const product = await createProduct(ctx);

    await expectServiceError(addProductImages(ctx, product.id, [await jpeg(), await jpeg(), await jpeg()]), "CONFLICT");
    await addProductImages(ctx, product.id, [await jpeg(), await jpeg()]);
    await expectServiceError(addProductImages(ctx, product.id, [await jpeg()]), "CONFLICT");
    expect(await db.productImage.count({ where: { productId: product.id } })).toBe(2);

    // Limit is per product.
    const other = await createProduct(ctx);
    await expect(addProductImages(ctx, other.id, [await jpeg()])).resolves.toHaveLength(1);
  });

  it("enforces the storage quota and cleans up stored files", async () => {
    const ctx = await createTenantContext();
    await setPlatform(ctx, { storageQuotaGb: 30_000 / 1024 ** 3 }); // ~30 KB
    const product = await createProduct(ctx);
    // Noise does not compress: well above 30 KB once stored.
    const noise = await sharp(Buffer.from(Array.from({ length: 600 * 600 * 3 }, () => Math.floor(Math.random() * 256))), {
      raw: { width: 600, height: 600, channels: 3 },
    })
      .jpeg()
      .toBuffer();

    await expect(
      addProductImages(ctx, product.id, [{ name: "noise.jpg", type: "image/jpeg", bytes: new Uint8Array(noise) }]),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Storage quota exceeded" });
    expect(await db.productImage.count()).toBe(0);
    expect(await filesUnder(ctx.tenantId)).toEqual([]);
  });

  it("reorders (first = cover) and validates the id list", async () => {
    const ctx = await createTenantContext();
    const product = await createProduct(ctx);
    const imgs = await addProductImages(ctx, product.id, [await jpeg(), await jpeg(), await jpeg()]);
    const [a, b, c] = imgs.map((i) => i.id);

    const reordered = await reorderProductImages(ctx, product.id, [c, a, b]);
    expect(reordered.map((i) => i.id)).toEqual([c, a, b]);
    expect(reordered[0].isCover).toBe(true);
    expect((await listProductImages(ctx, product.id)).map((i) => i.id)).toEqual([c, a, b]);

    await expectServiceError(reorderProductImages(ctx, product.id, [a, b]), "INVALID");
    await expectServiceError(reorderProductImages(ctx, product.id, [a, a, b]), "INVALID");
    await expectServiceError(reorderProductImages(ctx, product.id, [a, b, "foreign"]), "INVALID");
  });

  it("updates alt text", async () => {
    const ctx = await createTenantContext();
    const product = await createProduct(ctx);
    const [img] = await addProductImages(ctx, product.id, [await jpeg()]);
    expect((await updateImageAlt(ctx, img.id, "  Helmet M35  ")).alt).toBe("Helmet M35");
    expect((await updateImageAlt(ctx, img.id, "")).alt).toBeNull();
  });

  it("deletes the row and files, promoting the next image to cover", async () => {
    const ctx = await createTenantContext();
    const product = await createProduct(ctx);
    const [first, second, third] = await addProductImages(ctx, product.id, [await jpeg(), await jpeg(), await jpeg()]);
    const firstRow = await db.productImage.findUniqueOrThrow({ where: { id: first.id } });

    await deleteProductImage(ctx, first.id);
    expect(await db.productImage.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await driver.exists(firstRow.storageKey)).toBe(false);
    expect(await driver.exists(variantKey(firstRow.storageKey, "thumb"))).toBe(false);

    const rest = await listProductImages(ctx, product.id);
    expect(rest.map((i) => [i.id, i.sortOrder])).toEqual([
      [second.id, 0],
      [third.id, 1],
    ]);
    expect(await db.auditLog.count({ where: { action: "product.image.deleted" } })).toBe(1);

    await deleteProductMedia(ctx, product.id);
    expect(await filesUnder(`${ctx.tenantId}/products/${product.id}`)).toEqual([]);
  });
});
