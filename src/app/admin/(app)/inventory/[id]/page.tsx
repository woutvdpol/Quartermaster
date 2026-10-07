import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getProduct, statusBlocker, type ProductDetail } from "@/server/catalog/products";
import { listCategoryTree } from "@/server/catalog/categories";
import { listTags } from "@/server/catalog/tags";
import { listProductImages } from "@/server/media/product-images";
import { MAX_UPLOAD_BYTES } from "@/server/media/images";
import { listPurchaseRecords } from "@/server/purchasing";
import { listMovements } from "@/server/stock/ledger";
import { countWishlisted, getTenantDisplay, photoLimit } from "./_data";
import { UPLOAD_TRANSPORT_MAX_BYTES } from "./_lib/limits";
import { categoryOptions, purchaseRecordOption } from "./_lib/options";
import { DangerZone } from "./_components/DangerZone";
import { PhotosCard } from "./_components/PhotosCard";
import { ProductEditor, type EditorProduct } from "./_components/ProductEditor";
import { StatusCard } from "./_components/StatusCard";
import { StockControl } from "./_components/StockDrawer";

/** `[id]` is the product id; a plain number is accepted as stockCode (e.g. /admin/inventory/50231). */
const loadProduct = cache(async (id: string): Promise<{ ctx: Awaited<ReturnType<typeof requireStaffContext>>; product: ProductDetail }> => {
  const ctx = await requireStaffContext();
  try {
    const ref = /^\d{1,9}$/.test(id) ? { stockCode: Number(id) } : id;
    return { ctx, product: await getProduct(ctx, ref) };
  } catch (err) {
    if (err instanceof ServiceError && (err.code === "NOT_FOUND" || err.code === "INVALID")) notFound();
    throw err;
  }
});

export async function generateMetadata({ params }: PageProps<"/admin/inventory/[id]">): Promise<Metadata> {
  const { product } = await loadProduct((await params).id);
  return { title: `#${product.stockCode} ${product.title}` };
}

export default async function ProductEditPage({ params }: PageProps<"/admin/inventory/[id]">) {
  const { ctx, product } = await loadProduct((await params).id);

  const [images, tree, tags, records, movements, tenant, wishlistCount, limit] = await Promise.all([
    listProductImages(ctx, product.id),
    listCategoryTree(ctx),
    listTags(ctx),
    listPurchaseRecords(ctx, { pageSize: 200 }),
    listMovements(ctx, product.id, { limit: 50 }),
    getTenantDisplay(ctx),
    countWishlisted(ctx, product.id),
    photoLimit(ctx),
  ]);

  const recordOptions = records.items.map(purchaseRecordOption);
  // The linked record may be older than the first 200.
  if (product.purchaseRecord && !recordOptions.some((r) => r.id === product.purchaseRecord!.id)) {
    recordOptions.unshift(
      purchaseRecordOption({
        id: product.purchaseRecord.id,
        purchasedAt: product.purchaseRecord.purchasedAt,
        invoiceNumber: product.purchaseRecord.invoiceNumber,
        totalCost: null,
        currency: tenant.currency,
        supplier: product.purchaseRecord.supplier,
      }),
    );
  }

  const editorProduct: EditorProduct = {
    id: product.id,
    stockCode: product.stockCode,
    title: product.title,
    slug: product.slug,
    description: product.description ?? "",
    specifications: product.specifications,
    sku: product.sku ?? "",
    price: product.price,
    purchasePrice: product.purchasePrice,
    weightGrams: product.weightGrams,
    notes: product.notes ?? "",
    seoTitle: product.seoTitle ?? "",
    seoDescription: product.seoDescription ?? "",
    categoryId: product.categoryId ?? "",
    purchaseRecordId: product.purchaseRecordId ?? "",
    ageRestricted: product.ageRestricted,
    blurred: product.blurred,
    acceptsOffers: product.acceptsOffers,
    restrictedSymbols: product.restrictedSymbols,
    onSale: product.onSale,
    tags: product.tags.map((t) => t.name),
    updatedAt: product.updatedAt,
  };

  const deletable = product.status === "DRAFT" && product.orderLineCount === 0 && product.movementCount <= 1;

  return (
    <ProductEditor
      // Remount the editor when navigating between products (e.g. after Duplicate).
      key={product.id}
      product={editorProduct}
      currency={tenant.currency}
      timeZone={tenant.timeZone}
      shopHost={tenant.shopHost}
      shopName={tenant.name}
      categories={categoryOptions(tree)}
      purchaseRecords={recordOptions}
      tagSuggestions={tags.map((t) => t.name)}
      slots={{
        photos: (
          <PhotosCard
            productId={product.id}
            photos={images.map((i) => ({ id: i.id, url: i.urls.thumb, name: i.originalFilename ?? `photo-${i.sortOrder + 1}`, alt: i.alt }))}
            limit={limit}
            transportMaxBytes={UPLOAD_TRANSPORT_MAX_BYTES}
            serviceMaxBytes={MAX_UPLOAD_BYTES}
          />
        ),
        status: (
          <StatusCard
            productId={product.id}
            status={product.status}
            activeBlocker={statusBlocker(product, "ACTIVE")}
            publishedAt={product.publishedAt}
            soldAt={product.soldAt}
            reservation={product.reservation ? { expiresAt: product.reservation.expiresAt } : null}
            wishlistCount={wishlistCount}
            timeZone={tenant.timeZone}
          />
        ),
        stock: (
          <StockControl
            productId={product.id}
            stockCode={product.stockCode}
            quantity={product.quantity}
            movements={movements.map((m) => ({
              id: m.id,
              delta: m.delta,
              quantityAfter: m.quantityAfter,
              reason: m.reason,
              note: m.note,
              actorEmail: m.actorEmail,
              createdAt: m.createdAt,
            }))}
            timeZone={tenant.timeZone}
          />
        ),
        danger: <DangerZone productId={product.id} stockCode={product.stockCode} deletable={deletable} archived={product.status === "ARCHIVED"} />,
      }}
    />
  );
}
