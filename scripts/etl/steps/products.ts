import { Prisma } from "../../../src/generated/prisma/client";
import { ETL_MARK, chunk, isEtlOwned, json, sameValues, type EtlContext } from "../context";
import { decodeSpecifications } from "../transforms/json";
import { deriveProductStatus } from "../transforms/status";
import { assignUniqueSlugs } from "../transforms/slugs";

const PROVENANCE_HINT = /collect|herkomst|provenance|\bex\s|nalatenschap|estate|papieren|papers/i;

const COMPARED = {
  id: true,
  stockCode: true,
  slug: true,
  sku: true,
  title: true,
  description: true,
  specifications: true,
  status: true,
  price: true,
  purchasePrice: true,
  weightGrams: true,
  importance: true,
  publishedAt: true,
  soldAt: true,
  ageRestricted: true,
  blurred: true,
  onSale: true,
  notes: true,
  categoryId: true,
  purchaseRecordId: true,
  legacyData: true,
} as const;
type ExistingProduct = Prisma.ProductGetPayload<{ select: typeof COMPARED }>;

/**
 * Legacy `products` → Product (upsert on stockCode = products.id, decision 26), plus tags pivot,
 * related products and the opening stock ledger entry. Photos are handled by the images step.
 */
export async function productsStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const rows = await ctx.legacy.read("products");
  report.legacy("products", rows.length);

  const existing: ExistingProduct[] = await tx.product.findMany({
    where: { tenantId },
    select: COMPARED,
  });
  const byCode = new Map(existing.map((p) => [p.stockCode, p]));
  const foreign = existing.filter((p) => !isEtlOwned(p));
  const foreignCodes = new Set(foreign.map((p) => p.stockCode));

  const importable = rows.filter((r) => {
    if (!Number.isInteger(r.id) || r.id <= 0) {
      report.skip("products", "ongeldige id");
      return false;
    }
    if (foreignCodes.has(r.id)) {
      report.skip("products", "stockCode bestaat al (niet-ETL product)");
      report.warn(`product legacy #${r.id}: stockCode already used by a non-ETL product → skipped`);
      return false;
    }
    return true;
  });

  // Slugs: deterministic in id order; legacy slugs were not unique (`test` ×3 in the test dump).
  const { slugs, collisions } = assignUniqueSlugs(
    importable.map((r) => ({ key: r.id, slug: r.slug, title: r.title, fallback: `item-${r.id}` })),
    foreign.map((p) => p.slug),
  );
  for (const c of collisions) report.note("Slug-botsingen", `product #${c.key}: "${c.wanted}" → "${c.assigned}"`);

  // SKU: '' → null; duplicates keep the first (by id), later ones are cleared (reported).
  const takenSku = new Set(foreign.map((p) => p.sku).filter((s): s is string => !!s));
  const skus = new Map<number, string | null>();
  for (const r of importable) {
    const sku = r.sku?.trim() || null;
    if (sku && takenSku.has(sku)) {
      skus.set(r.id, null);
      report.note("Dubbele SKU's (geleegd)", `product #${r.id}`);
      continue;
    }
    if (sku) takenSku.add(sku);
    skus.set(r.id, sku);
  }

  const categories = new Map(
    (await tx.category.findMany({ where: { tenantId, legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((c) => [c.legacyId!, c.id]),
  );
  const purchaseRecords = new Map(
    (await tx.purchaseRecord.findMany({ where: { tenantId, legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((p) => [p.legacyId!, p.id]),
  );

  // Free slugs/SKUs that move between ETL rows first (unique indexes are checked per statement).
  for (const r of importable) {
    const cur = byCode.get(r.id);
    if (cur && (cur.slug !== slugs.get(r.id) || (cur.sku !== skus.get(r.id) && cur.sku !== null))) {
      await tx.product.update({ where: { id: cur.id }, data: { slug: `etl-tmp-${r.id}`, sku: null } });
    }
  }

  const toCreate: Prisma.ProductCreateManyInput[] = [];
  let negativeQty = 0;
  for (const r of importable) {
    const specs = decodeSpecifications(r.specifications);
    if (specs.error) report.warn(`product #${r.id}: specifications not parseable (${specs.error}) → kept in legacyData`);
    const quantity = Math.max(0, r.quantity ?? 0);
    if ((r.quantity ?? 0) < 0) negativeQty++;
    const status = deriveProductStatus({ active: r.active, stockControl: r.stock_control, quantity });
    if (r.category_id !== null && !categories.has(r.category_id)) report.warn(`product #${r.id}: category #${r.category_id} not found`);
    if (r.notes && PROVENANCE_HINT.test(r.notes)) report.note("Mogelijke herkomstinformatie in notes (handmatig overnemen)", `product #${r.id}`);

    const legacyData = json({
      etl: ETL_MARK,
      active: r.active,
      stockControl: r.stock_control,
      productId: r.product_id,
      photoCount: r.photo_count,
      productReservedOn: r.product_reserved_on,
      legacySlug: r.slug,
      ...(specs.error ? { specificationsRaw: r.specifications } : {}),
      ...((r.quantity ?? 0) < 0 ? { legacyQuantity: r.quantity } : {}),
    });
    const data = {
      sku: skus.get(r.id) ?? null,
      slug: slugs.get(r.id)!,
      title: (r.title ?? "").trim() || `Item ${r.id}`,
      description: r.description?.trim() || null,
      specifications: specs.specs ? json(specs.specs) : undefined,
      status,
      price: Math.max(0, r.price ?? 0),
      purchasePrice: r.purchase_price === null ? null : Math.max(0, r.purchase_price),
      weightGrams: Math.max(0, r.weight ?? 0),
      importance: r.importance ?? 0,
      // Legacy `updated_at` was the listing / "bump to top" date (docs/etl/alerts.md: never now()).
      publishedAt: r.updated_at ?? r.created_at ?? null,
      soldAt: r.sold_on,
      ageRestricted: !!r.age_restricted,
      blurred: !!r.blur,
      onSale: !!r.sale_item,
      notes: r.notes?.trim() || null,
      categoryId: r.category_id !== null ? (categories.get(r.category_id) ?? null) : null,
      purchaseRecordId: r.purchase_record_id !== null ? (purchaseRecords.get(r.purchase_record_id) ?? null) : null,
      legacyData,
    };
    const cur = byCode.get(r.id);
    if (cur) {
      const comparable = { ...data, specifications: data.specifications ?? null };
      if (sameValues(cur, comparable)) {
        report.unchanged("products");
      } else {
        await tx.product.update({ where: { id: cur.id }, data: { ...data, specifications: data.specifications ?? Prisma.DbNull } });
        report.updated("products");
      }
    } else {
      toCreate.push({
        tenantId,
        stockCode: r.id,
        quantity: 0,
        ...data,
        ...(r.created_at ? { createdAt: r.created_at } : {}),
      });
    }
  }
  if (negativeQty) report.warn(`${negativeQty} products had a negative legacy quantity → 0 (raw value in legacyData.legacyQuantity)`);
  for (const part of chunk(toCreate, 500)) {
    await tx.product.createMany({ data: part });
    report.created("products", part.length);
  }

  // Map stockCode → id for everything the ETL owns now.
  const owned = new Map(
    (
      await tx.product.findMany({
        where: { tenantId, stockCode: { in: importable.map((r) => r.id) } },
        select: { id: true, stockCode: true, quantity: true },
      })
    ).map((p) => [p.stockCode, p]),
  );

  // ── Stock ledger: Product.quantity must equal Σ StockMovement.delta. ──
  const sums = new Map(
    (
      await tx.stockMovement.groupBy({
        by: ["productId"],
        where: { tenantId, productId: { in: [...owned.values()].map((p) => p.id) } },
        _sum: { delta: true },
      })
    ).map((g) => [g.productId, g._sum.delta ?? 0]),
  );
  const movements: Prisma.StockMovementCreateManyInput[] = [];
  for (const r of importable) {
    const p = owned.get(r.id);
    if (!p) continue;
    const target = Math.max(0, r.quantity ?? 0);
    const sum = sums.get(p.id) ?? 0;
    if (target !== sum) {
      movements.push({
        tenantId,
        productId: p.id,
        delta: target - sum,
        quantityAfter: target,
        reason: "ADJUSTMENT",
        note: sum === 0 && !sums.has(p.id) ? "ETL opening balance" : "ETL resync with Concept500",
        createdAt: r.created_at ?? ctx.now,
      });
    }
    if (p.quantity !== target) await tx.product.update({ where: { id: p.id }, data: { quantity: target } });
  }
  for (const part of chunk(movements, 1000)) await tx.stockMovement.createMany({ data: part });
  if (movements.length) report.created("stock movements (opening balance)", movements.length);

  await syncProductTags(ctx, owned);
  await syncRelatedProducts(ctx, owned);
}

async function syncProductTags(ctx: EtlContext, owned: Map<number, { id: string }>) {
  const { tx, report, tenantId } = ctx;
  const pivots = await ctx.legacy.read("product_tag");
  report.legacy("product tags", pivots.length);
  const tags = new Map(
    (await tx.tag.findMany({ where: { tenantId, legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((t) => [t.legacyId!, t.id]),
  );
  const wanted = new Map<string, { productId: string; tagId: string }>();
  for (const p of pivots) {
    const productId = owned.get(p.product_id)?.id;
    const tagId = tags.get(p.tag_id);
    if (!productId || !tagId) {
      report.skip("product tags", !productId ? "product ontbreekt" : "tag ontbreekt");
      continue;
    }
    const key = `${productId}:${tagId}`;
    if (wanted.has(key)) report.skip("product tags", "dubbele pivot samengevoegd");
    else wanted.set(key, { productId, tagId });
  }
  const productIds = [...owned.values()].map((p) => p.id);
  const current = await tx.productTag.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, tagId: true } });
  const currentKeys = new Set(current.map((c) => `${c.productId}:${c.tagId}`));
  const legacyTagIds = new Set(tags.values());
  // Only remove links to legacy tags (links to tags created in Quartermaster are left alone).
  const stale = current.filter((c) => !wanted.has(`${c.productId}:${c.tagId}`) && legacyTagIds.has(c.tagId));
  for (const s of stale) await tx.productTag.delete({ where: { productId_tagId: { productId: s.productId, tagId: s.tagId } } });
  const add = [...wanted.entries()].filter(([k]) => !currentKeys.has(k)).map(([, v]) => ({ tenantId, ...v }));
  for (const part of chunk(add, 1000)) await tx.productTag.createMany({ data: part, skipDuplicates: true });
  report.created("product tags", add.length);
  report.unchanged("product tags", wanted.size - add.length);
}

async function syncRelatedProducts(ctx: EtlContext, owned: Map<number, { id: string }>) {
  const { tx, report, tenantId } = ctx;
  const rows = await ctx.legacy.read("related_products");
  report.legacy("related products", rows.length);
  const wanted = new Map<string, { productId: string; relatedProductId: string; sortOrder: number }>();
  const order = new Map<string, number>();
  for (const r of rows) {
    const productId = owned.get(r.product_id)?.id;
    const relatedProductId = owned.get(r.related_product_id)?.id;
    if (!productId || !relatedProductId) {
      report.skip("related products", "product ontbreekt");
      continue;
    }
    if (productId === relatedProductId) {
      report.skip("related products", "verwijst naar zichzelf");
      continue;
    }
    const key = `${productId}:${relatedProductId}`;
    if (wanted.has(key)) {
      report.skip("related products", "dubbel");
      continue;
    }
    const n = order.get(productId) ?? 0;
    order.set(productId, n + 1);
    wanted.set(key, { productId, relatedProductId, sortOrder: n });
  }
  const productIds = [...owned.values()].map((p) => p.id);
  const current = await tx.productRelation.findMany({ where: { tenantId, productId: { in: productIds } } });
  const currentKeys = new Set(current.map((c) => `${c.productId}:${c.relatedProductId}`));
  for (const c of current) {
    if (!wanted.has(`${c.productId}:${c.relatedProductId}`)) {
      await tx.productRelation.delete({ where: { productId_relatedProductId: { productId: c.productId, relatedProductId: c.relatedProductId } } });
    }
  }
  const add = [...wanted.entries()].filter(([k]) => !currentKeys.has(k)).map(([, v]) => ({ tenantId, ...v }));
  for (const part of chunk(add, 1000)) await tx.productRelation.createMany({ data: part, skipDuplicates: true });
  report.created("related products", add.length);
  report.unchanged("related products", wanted.size - add.length);
}
