import "server-only";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { getProduct, listProducts } from "@/server/catalog/products";
import { imageUrl } from "@/server/media/product-images";

/*
 * Read helpers for the page editor's pickers. There is no general media library service yet, so
 * `searchProductImages` reads product photos directly (tenant-scoped, read-only). Replace it with a
 * media-library service call once one exists.
 */

export type PickerProduct = { id: string; title: string; stockCode: number; status: string; thumbUrl: string | null };
export type PickerImage = { key: string; thumbUrl: string; label: string };

export async function searchProductImages(ctx: ServiceContext, query: string): Promise<PickerImage[]> {
  const q = query.trim().replace(/^#/, "").slice(0, 100);
  const or = q
    ? [{ title: { contains: q, mode: "insensitive" as const } }, ...(/^\d{1,9}$/.test(q) ? [{ stockCode: Number(q) }] : [])]
    : undefined;
  const rows = await db.productImage.findMany({
    where: { tenantId: ctx.tenantId, ...(or ? { product: { tenantId: ctx.tenantId, OR: or } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 48,
    select: { storageKey: true, alt: true, product: { select: { title: true, stockCode: true } } },
  });
  return rows.map((r) => ({
    key: r.storageKey,
    thumbUrl: imageUrl(r.storageKey, "thumb"),
    label: r.alt || `#${r.product.stockCode} ${r.product.title}`,
  }));
}

export async function searchPickerProducts(ctx: ServiceContext, query: string): Promise<PickerProduct[]> {
  const { rows } = await listProducts(ctx, { search: query.trim().slice(0, 200) || undefined, pageSize: 20, view: "all" });
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    stockCode: p.stockCode,
    status: p.status,
    thumbUrl: p.cover ? imageUrl(p.cover.storageKey, "thumb") : null,
  }));
}

/** Summaries of the products referenced by TEXT_PRODUCT blocks (missing ones are left out). */
export async function productSummaries(ctx: ServiceContext, ids: string[]): Promise<Record<string, PickerProduct>> {
  const out: Record<string, PickerProduct> = {};
  await Promise.all(
    [...new Set(ids)].slice(0, 50).map(async (id) => {
      try {
        const p = await getProduct(ctx, id);
        const cover = p.images[0];
        out[id] = { id, title: p.title, stockCode: p.stockCode, status: p.status, thumbUrl: cover ? imageUrl(cover.storageKey, "thumb") : null };
      } catch {
        // Deleted product: the block shows "no longer exists".
      }
    }),
  );
  return out;
}
