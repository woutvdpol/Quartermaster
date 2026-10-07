import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { nextSequenceValue } from "@/server/sequence";
import { ServiceError, type ServiceContext } from "@/server/context";
import { recordMovement } from "@/server/stock/ledger";
import { Prisma } from "@/generated/prisma/client";
import type { ProductStatus } from "@/generated/prisma/enums";
import { isUniqueViolation, notFound, parseInput } from "./errors";
import { adjustPriceByPercent, margin } from "./pricing";
import { nextFreeSlug, slugify } from "./slug";

/*
 * Product admin services.
 *
 * Status rules (decision 11 leaves semantics to this service):
 *  - ACTIVE   requires price > 0 and quantity > 0; sets publishedAt when null; clears soldAt.
 *  - SOLD     sets soldAt when null. Does NOT move stock — order finalisation (orders module)
 *             writes the SALE movement; a manual "mark sold" is a status flag only.
 *  - DRAFT    clears soldAt.
 *  - ARCHIVED / RESERVED / STOLEN: allowed from any status.
 *  - Any status other than ACTIVE releases a live cart reservation on the product.
 * Bulk status changes are all-or-nothing: if one product breaks a rule nothing changes and
 * ServiceError("INVALID") carries details: [{ id, stockCode, reason }].
 *
 * Products are never hard-deleted once they have history: deleteProduct only accepts DRAFTs
 * without order lines and with at most the opening stock movement; otherwise CONFLICT → archive.
 */

type Tx = Prisma.TransactionClient;

// ─── Validation ─────────────────────────────────────────────────────────────

const MAX_IDS = 500;
const money = z.int().min(0).max(1_000_000_000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const idSchema = z.string().min(1).max(64);
const idsSchema = z.array(idSchema).min(1).max(MAX_IDS);

const specificationsSchema = z
  .array(z.object({ label: z.string().trim().min(1).max(200), value: z.string().trim().max(2000) }))
  .max(100)
  .nullish();

const editableFields = {
  title: z.string().trim().min(1).max(300),
  description: optionalText(100_000),
  specifications: specificationsSchema,
  sku: optionalText(100),
  price: money,
  purchasePrice: money.nullish(),
  weightGrams: z.int().min(0).max(10_000_000),
  importance: z.int().min(-100_000).max(100_000),
  ageRestricted: z.boolean(),
  blurred: z.boolean(),
  acceptsOffers: z.boolean(),
  restrictedSymbols: z.boolean(),
  onSale: z.boolean(),
  notes: optionalText(20_000),
  seoTitle: optionalText(200),
  seoDescription: optionalText(500),
  categoryId: idSchema.nullish(),
  purchaseRecordId: idSchema.nullish(),
  tagIds: z.array(idSchema).max(100),
};

const createSchema = z.object({
  ...editableFields,
  price: money.default(0),
  weightGrams: editableFields.weightGrams.default(0),
  importance: editableFields.importance.default(0),
  ageRestricted: z.boolean().default(false),
  blurred: z.boolean().default(false),
  acceptsOffers: z.boolean().default(false),
  restrictedSymbols: z.boolean().default(false),
  onSale: z.boolean().default(false),
  tagIds: editableFields.tagIds.default([]),
  slug: z.string().trim().max(120).optional(),
  /** Opening stock; unique items → default 1. Booked as a stock movement. */
  quantity: z.int().min(0).max(1_000_000).default(1),
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
});

const updateSchema = z
  .object({
    ...editableFields,
    /** Explicit new slug (slugified; CONFLICT when taken). */
    slug: z.string().trim().min(1).max(120),
    /** Regenerate the slug from the (new) title, de-duplicated. */
    regenerateSlug: z.boolean(),
  })
  .partial();

export type CreateProductInput = z.input<typeof createSchema>;
export type UpdateProductInput = z.input<typeof updateSchema>;
export type Specification = { label: string; value: string };

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapProductConflict(err: unknown): never {
  if (isUniqueViolation(err, "sku")) throw new ServiceError("CONFLICT", "SKU is already used by another product");
  if (isUniqueViolation(err, "slug")) throw new ServiceError("CONFLICT", "Slug is already used by another product");
  throw err;
}

async function uniqueProductSlug(tx: Tx, tenantId: string, wanted: string, excludeId?: string) {
  const base = slugify(wanted) || "item";
  const rows = await tx.product.findMany({
    where: { tenantId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { slug: true },
  });
  return nextFreeSlug(
    base,
    rows.map((r) => r.slug),
  );
}

/** Rejects references to another tenant's (or a non-existent) category / purchase record / tags. */
async function assertRefs(tx: Tx, tenantId: string, refs: { categoryId?: string | null; purchaseRecordId?: string | null; tagIds?: string[] }) {
  if (refs.categoryId && !(await tx.category.findFirst({ where: { id: refs.categoryId, tenantId }, select: { id: true } }))) {
    throw new ServiceError("INVALID", "Unknown category", { field: "categoryId" });
  }
  if (refs.purchaseRecordId && !(await tx.purchaseRecord.findFirst({ where: { id: refs.purchaseRecordId, tenantId }, select: { id: true } }))) {
    throw new ServiceError("INVALID", "Unknown purchase record", { field: "purchaseRecordId" });
  }
  if (refs.tagIds?.length) {
    const unique = [...new Set(refs.tagIds)];
    const n = await tx.tag.count({ where: { tenantId, id: { in: unique } } });
    if (n !== unique.length) throw new ServiceError("INVALID", "Unknown tag", { field: "tagIds" });
  }
}

/** Loads the given products of the tenant; any missing id → NOT_FOUND. */
async function requireProducts(tx: Tx, tenantId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await tx.product.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, stockCode: true, status: true, price: true, quantity: true },
  });
  if (rows.length !== unique.length) throw notFound(unique.length === 1 ? "Product" : "One or more products");
  return rows;
}

async function auditProducts(ctx: ServiceContext, action: string, ids: string[], data?: Prisma.InputJsonValue) {
  for (const id of new Set(ids)) {
    await audit({ action, tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Product", entityId: id, data });
  }
}

function toSpecJson(specs: Specification[] | null | undefined) {
  if (specs === undefined) return undefined;
  return specs === null || specs.length === 0 ? Prisma.DbNull : (specs as Prisma.InputJsonValue);
}

// ─── List ───────────────────────────────────────────────────────────────────

export const PRODUCT_VIEWS = ["all", "forSale", "inCart", "draft", "sold", "archived", "noPhoto"] as const;
export type ProductView = (typeof PRODUCT_VIEWS)[number];
export const PRODUCT_SORTS = ["publishedAt", "price", "stockCode", "title"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

const listSchema = z.object({
  view: z.enum(PRODUCT_VIEWS).default("all"),
  search: z.string().trim().max(200).optional(),
  /** A category id, or null for "uncategorised". */
  categoryId: idSchema.nullable().optional(),
  tagIds: z.array(idSchema).max(50).optional(),
  tagMatch: z.enum(["any", "all"]).default("any"),
  priceMin: money.optional(),
  priceMax: money.optional(),
  purchaseRecordId: idSchema.optional(),
  sort: z.enum(PRODUCT_SORTS).default("publishedAt"),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.int().min(1).max(100_000).optional(),
  pageSize: z.int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
});

export type ListProductsQuery = z.input<typeof listSchema>;
export type ProductViewCounts = Record<ProductView, number>;

export type ProductListRow = {
  id: string;
  stockCode: number;
  sku: string | null;
  slug: string;
  title: string;
  status: ProductStatus;
  price: number;
  purchasePrice: number | null;
  /** price − purchasePrice in cents; null without purchase price. */
  margin: number | null;
  quantity: number;
  publishedAt: Date | null;
  soldAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  blurred: boolean;
  category: { id: string; title: string } | null;
  /** Image with the lowest sortOrder (0 = primary), or null. */
  cover: { id: string; storageKey: string; variants: Prisma.JsonValue; alt: string | null; width: number | null; height: number | null } | null;
  /** Expiry of the live cart reservation ("in cart · mm:ss"), or null. */
  reservedUntil: Date | null;
};

export type ListProductsResult = {
  rows: ProductListRow[];
  /** Tab counts, with every filter except `view` applied. */
  counts: ProductViewCounts;
  /** Rows matching the current view + filters (= counts[view]). */
  total: number;
  pageSize: number;
  /** Set in page mode. */
  page: number | null;
  /** Opaque keyset cursor for the next page, null at the end. Works in both modes. */
  nextCursor: string | null;
};

const LIVE_RESERVATION = Prisma.sql`EXISTS (SELECT 1 FROM reservations r WHERE r."productId" = p.id AND r.status = 'ACTIVE' AND r."expiresAt" > now())`;
const HAS_PHOTO = Prisma.sql`EXISTS (SELECT 1 FROM product_images i WHERE i."productId" = p.id)`;

/** SQL predicate per view, evaluated over the derived table `f` (columns of products + live + has_photo). */
const VIEW_SQL: Record<ProductView, Prisma.Sql> = {
  all: Prisma.sql`f.status <> 'ARCHIVED'`,
  forSale: Prisma.sql`f.status = 'ACTIVE' AND NOT f.live`,
  inCart: Prisma.sql`f.live`,
  draft: Prisma.sql`f.status = 'DRAFT'`,
  sold: Prisma.sql`f.status = 'SOLD'`,
  archived: Prisma.sql`f.status = 'ARCHIVED'`,
  noPhoto: Prisma.sql`NOT f.has_photo AND f.status NOT IN ('SOLD', 'ARCHIVED')`,
};

const SORT_SQL: Record<ProductSort, Prisma.Sql> = {
  publishedAt: Prisma.sql`f.sort_published`,
  price: Prisma.sql`f.price`,
  stockCode: Prisma.sql`f."stockCode"`,
  title: Prisma.sql`f.title`,
};
const DEFAULT_DIR: Record<ProductSort, "asc" | "desc"> = { publishedAt: "desc", price: "asc", stockCode: "desc", title: "asc" };

type Cursor = { s: ProductSort; d: "asc" | "desc"; v: string | number; id: string };

function encodeCursor(c: Cursor) {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
function decodeCursor(raw: string, sort: ProductSort, dir: "asc" | "desc"): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString()) as Cursor;
    if (c.s === sort && c.d === dir && typeof c.id === "string" && (typeof c.v === "string" || typeof c.v === "number")) return c;
  } catch {
    // fall through
  }
  throw new ServiceError("INVALID", "Invalid cursor");
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function filterSql(tenantId: string, q: z.output<typeof listSchema>): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`p."tenantId" = ${tenantId}`];
  if (q.search) {
    const term = q.search.replace(/^#/, "");
    const like = `%${escapeLike(term)}%`;
    const or: Prisma.Sql[] = [Prisma.sql`p.title ILIKE ${like}`, Prisma.sql`p.sku ILIKE ${like}`];
    if (/^\d{1,9}$/.test(term)) or.push(Prisma.sql`p."stockCode" = ${Number(term)}`);
    parts.push(Prisma.sql`(${Prisma.join(or, " OR ")})`);
  }
  if (q.categoryId === null) parts.push(Prisma.sql`p."categoryId" IS NULL`);
  else if (q.categoryId) parts.push(Prisma.sql`p."categoryId" = ${q.categoryId}`);
  if (q.tagIds?.length) {
    const ids = [...new Set(q.tagIds)];
    if (q.tagMatch === "all") {
      parts.push(Prisma.sql`(SELECT count(DISTINCT pt."tagId") FROM product_tags pt WHERE pt."productId" = p.id AND pt."tagId" = ANY(${ids}::text[])) = ${ids.length}`);
    } else {
      parts.push(Prisma.sql`EXISTS (SELECT 1 FROM product_tags pt WHERE pt."productId" = p.id AND pt."tagId" = ANY(${ids}::text[]))`);
    }
  }
  if (q.priceMin !== undefined) parts.push(Prisma.sql`p.price >= ${q.priceMin}`);
  if (q.priceMax !== undefined) parts.push(Prisma.sql`p.price <= ${q.priceMax}`);
  if (q.purchaseRecordId) parts.push(Prisma.sql`p."purchaseRecordId" = ${q.purchaseRecordId}`);
  return Prisma.join(parts, " AND ");
}

/**
 * Admin product list. `view` selects a tab:
 *  all (everything except ARCHIVED) · forSale (ACTIVE, not in a cart) · inCart (live reservation,
 *  any status) · draft · sold · archived · noPhoto (no images, not SOLD/ARCHIVED).
 * Search matches title/SKU (case-insensitive substring) or the exact stockCode ("50012" / "#50012").
 * Sort: publishedAt (listing date; falls back to createdAt for never-published items) desc by default,
 * price, stockCode, title; ties broken by id. Pagination: `page` (offset) or `cursor` (keyset; wins when
 * both are given). `counts` holds every tab's count under the same non-view filters (one grouped query).
 */
export async function listProducts(ctx: ServiceContext, query: ListProductsQuery = {}): Promise<ListProductsResult> {
  const q = parseInput(listSchema, query);
  const dir = q.dir ?? DEFAULT_DIR[q.sort];
  const derived = Prisma.sql`(
    SELECT p.id, p.status, p.price, p."stockCode", p.title,
           coalesce(p."publishedAt", p."createdAt") AS sort_published,
           ${LIVE_RESERVATION} AS live, ${HAS_PHOTO} AS has_photo
    FROM products p
    WHERE ${filterSql(ctx.tenantId, q)}
  ) f`;

  const countsPromise = db.$queryRaw<Record<ProductView, number>[]>`
    SELECT ${Prisma.join(
      PRODUCT_VIEWS.map((v) => Prisma.sql`count(*) FILTER (WHERE ${VIEW_SQL[v]})::int AS ${Prisma.raw(`"${v}"`)}`),
      ", ",
    )}
    FROM ${derived}`;

  const sortExpr = SORT_SQL[q.sort];
  const dirSql = Prisma.raw(dir === "asc" ? "ASC" : "DESC");
  const where: Prisma.Sql[] = [VIEW_SQL[q.view]];
  let offset = 0;
  if (q.cursor) {
    const c = decodeCursor(q.cursor, q.sort, dir);
    const v = q.sort === "publishedAt" ? Prisma.sql`${String(c.v).replace(/Z$/, "")}::timestamp(3)` : Prisma.sql`${c.v}`;
    where.push(dir === "asc" ? Prisma.sql`(${sortExpr}, f.id) > (${v}, ${c.id})` : Prisma.sql`(${sortExpr}, f.id) < (${v}, ${c.id})`);
  } else {
    offset = ((q.page ?? 1) - 1) * q.pageSize;
  }
  const idsPromise = db.$queryRaw<{ id: string; sort_value: Date | number | string }[]>`
    SELECT f.id, ${sortExpr} AS sort_value
    FROM ${derived}
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY ${sortExpr} ${dirSql}, f.id ${dirSql}
    LIMIT ${q.pageSize + 1} OFFSET ${offset}`;

  const [[counts], idRows] = await Promise.all([countsPromise, idsPromise]);
  const hasMore = idRows.length > q.pageSize;
  const pageIds = idRows.slice(0, q.pageSize);
  const last = pageIds.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor({ s: q.sort, d: dir, id: last.id, v: last.sort_value instanceof Date ? last.sort_value.toISOString() : last.sort_value })
      : null;

  const now = new Date();
  const products = pageIds.length
    ? await db.product.findMany({
        where: { tenantId: ctx.tenantId, id: { in: pageIds.map((r) => r.id) } },
        include: {
          category: { select: { id: true, title: true } },
          images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { id: true, storageKey: true, variants: true, alt: true, width: true, height: true } },
          reservations: { where: { status: "ACTIVE", expiresAt: { gt: now } }, take: 1, select: { expiresAt: true } },
        },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows: ProductListRow[] = pageIds.flatMap(({ id }) => {
    const p = byId.get(id);
    if (!p) return [];
    return [
      {
        id: p.id,
        stockCode: p.stockCode,
        sku: p.sku,
        slug: p.slug,
        title: p.title,
        status: p.status,
        price: p.price,
        purchasePrice: p.purchasePrice,
        margin: margin(p.price, p.purchasePrice),
        quantity: p.quantity,
        publishedAt: p.publishedAt,
        soldAt: p.soldAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        blurred: p.blurred,
        category: p.category,
        cover: p.images[0] ?? null,
        reservedUntil: p.reservations[0]?.expiresAt ?? null,
      },
    ];
  });

  return { rows, counts, total: counts[q.view], pageSize: q.pageSize, page: q.cursor ? null : (q.page ?? 1), nextCursor };
}

// ─── Read one ───────────────────────────────────────────────────────────────

const detailInclude = {
  category: { select: { id: true, title: true, parentId: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  images: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
  purchaseRecord: { select: { id: true, purchasedAt: true, invoiceNumber: true, supplier: { select: { id: true, name: true } } } },
  relatedTo: { orderBy: { sortOrder: "asc" as const }, select: { sortOrder: true, relatedProduct: { select: { id: true, stockCode: true, title: true, status: true } } } },
  _count: { select: { orderLines: true, stockMovements: true } },
} satisfies Prisma.ProductInclude;

/** Full product for the edit screen: relations, tags, images, live reservation, margin, counts. */
export async function getProduct(ctx: ServiceContext, ref: string | { stockCode: number }) {
  const where: Prisma.ProductWhereInput =
    typeof ref === "string" ? { id: ref, tenantId: ctx.tenantId } : { stockCode: ref.stockCode, tenantId: ctx.tenantId };
  const p = await db.product.findFirst({
    where,
    include: {
      ...detailInclude,
      reservations: { where: { status: "ACTIVE", expiresAt: { gt: new Date() } }, take: 1, select: { id: true, cartId: true, orderId: true, expiresAt: true } },
    },
  });
  if (!p) throw notFound("Product");
  const { tags, reservations, relatedTo, _count, ...rest } = p;
  return {
    ...rest,
    specifications: (rest.specifications as Specification[] | null) ?? [],
    tags: tags.map((t) => t.tag),
    related: relatedTo.map((r) => r.relatedProduct),
    reservation: reservations[0] ?? null,
    margin: margin(rest.price, rest.purchasePrice),
    orderLineCount: _count.orderLines,
    movementCount: _count.stockMovements,
  };
}

export type ProductDetail = Awaited<ReturnType<typeof getProduct>>;

// ─── Create / duplicate ─────────────────────────────────────────────────────

type CreateData = z.output<typeof createSchema>;

async function createInTx(tx: Tx, ctx: ServiceContext, data: CreateData, note: string) {
  await assertRefs(tx, ctx.tenantId, data);
  if (data.status === "ACTIVE" && (data.price <= 0 || data.quantity <= 0)) {
    throw new ServiceError("INVALID", "An active product needs a price and stock");
  }
  const stockCode = await nextSequenceValue(tx, ctx.tenantId, "product.stockCode");
  const slug = await uniqueProductSlug(tx, ctx.tenantId, data.slug || data.title);
  const product = await tx.product.create({
    data: {
      tenantId: ctx.tenantId,
      stockCode,
      slug,
      title: data.title,
      description: data.description,
      specifications: toSpecJson(data.specifications),
      sku: data.sku,
      price: data.price,
      purchasePrice: data.purchasePrice ?? null,
      weightGrams: data.weightGrams,
      importance: data.importance,
      ageRestricted: data.ageRestricted,
      blurred: data.blurred,
      acceptsOffers: data.acceptsOffers,
      restrictedSymbols: data.restrictedSymbols,
      onSale: data.onSale,
      notes: data.notes,
      seoTitle: data.seoTitle,
      seoDescription: data.seoDescription,
      categoryId: data.categoryId ?? null,
      purchaseRecordId: data.purchaseRecordId ?? null,
      status: data.status,
      publishedAt: data.status === "ACTIVE" ? new Date() : null,
    },
    select: { id: true, stockCode: true, slug: true },
  });
  if (data.tagIds.length) {
    await tx.productTag.createMany({
      data: [...new Set(data.tagIds)].map((tagId) => ({ tenantId: ctx.tenantId, productId: product.id, tagId })),
    });
  }
  if (data.quantity > 0) {
    await recordMovement(tx, {
      tenantId: ctx.tenantId,
      productId: product.id,
      delta: data.quantity,
      reason: data.purchaseRecordId ? "PURCHASE" : "ADJUSTMENT",
      actorId: ctx.actor.id,
      note,
    });
  }
  return product;
}

/** Runs a create, retrying when a concurrent create grabbed the same slug (the tx rolls back, so no stockCode gap). */
async function withSlugRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < 3 && isUniqueViolation(err, "slug")) continue;
      mapProductConflict(err);
    }
  }
}

/**
 * Creates a product: stockCode from the tenant sequence (same tx → no gaps), unique slug
 * (from `slug` or title; "-2", "-3" suffixes), DRAFT unless `status: "ACTIVE"` (then price > 0 and
 * quantity > 0 required). Opening `quantity` (default 1) is booked as a PURCHASE movement when a
 * purchase record is linked, else ADJUSTMENT. Returns { id, stockCode, slug }.
 */
export async function createProduct(ctx: ServiceContext, input: CreateProductInput) {
  const data = parseInput(createSchema, input);
  const product = await withSlugRetry(() => db.$transaction((tx) => createInTx(tx, ctx, data, "Opening stock")));
  await auditProducts(ctx, "product.create", [product.id], { stockCode: product.stockCode, title: data.title });
  return product;
}

/**
 * Copies a product into a new DRAFT: new stockCode and slug, SKU cleared (unique), tags/category/
 * purchase record copied, opening quantity `opts.quantity` (default 1). Images, related products,
 * publishedAt/soldAt and legacyData are NOT copied — images belong to the physical item and live in
 * storage per product id (the media module would have to copy files).
 */
export async function duplicateProduct(ctx: ServiceContext, id: string, opts: { quantity?: number } = {}) {
  const src = await db.product.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { tags: { select: { tagId: true } } } });
  if (!src) throw notFound("Product");
  const data = parseInput(createSchema, {
    title: src.title,
    description: src.description,
    specifications: (src.specifications as Specification[] | null) ?? null,
    sku: null,
    price: src.price,
    purchasePrice: src.purchasePrice,
    weightGrams: src.weightGrams,
    importance: src.importance,
    ageRestricted: src.ageRestricted,
    blurred: src.blurred,
    acceptsOffers: src.acceptsOffers,
    restrictedSymbols: src.restrictedSymbols,
    onSale: src.onSale,
    notes: src.notes,
    seoTitle: src.seoTitle,
    seoDescription: src.seoDescription,
    categoryId: src.categoryId,
    purchaseRecordId: src.purchaseRecordId,
    tagIds: src.tags.map((t) => t.tagId),
    quantity: opts.quantity ?? 1,
    status: "DRAFT",
  } satisfies CreateProductInput);
  const product = await withSlugRetry(() => db.$transaction((tx) => createInTx(tx, ctx, data, `Opening stock (duplicate of #${src.stockCode})`)));
  await auditProducts(ctx, "product.duplicate", [product.id], { from: src.id, fromStockCode: src.stockCode, stockCode: product.stockCode });
  return product;
}

// ─── Update ─────────────────────────────────────────────────────────────────

/**
 * Patches a product. Quantity and status are not editable here (use adjustStock / setStatus).
 * `tagIds` replaces the tag set. The slug changes only with an explicit `slug` (CONFLICT when taken)
 * or `regenerateSlug: true`. An ACTIVE product cannot get price 0 (INVALID).
 */
export async function updateProduct(ctx: ServiceContext, id: string, patch: UpdateProductInput) {
  const data = parseInput(updateSchema, patch);
  await db
    .$transaction(async (tx) => {
      const current = await tx.product.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { status: true, title: true } });
      if (!current) throw notFound("Product");
      await assertRefs(tx, ctx.tenantId, data);
      if (data.price === 0 && current.status === "ACTIVE") throw new ServiceError("INVALID", "An active product needs a price above 0");

      const { tagIds, slug, regenerateSlug, specifications, ...fields } = data;
      const update: Prisma.ProductUncheckedUpdateInput = { ...fields };
      if (specifications !== undefined) update.specifications = toSpecJson(specifications);
      if (slug) {
        const s = slugify(slug);
        if (!s) throw new ServiceError("INVALID", "Slug is empty");
        update.slug = s;
      } else if (regenerateSlug) {
        update.slug = await uniqueProductSlug(tx, ctx.tenantId, data.title ?? current.title, id);
      }
      await tx.product.update({ where: { id }, data: update });
      if (tagIds) {
        await tx.productTag.deleteMany({ where: { productId: id, tenantId: ctx.tenantId } });
        if (tagIds.length) {
          await tx.productTag.createMany({ data: [...new Set(tagIds)].map((tagId) => ({ tenantId: ctx.tenantId, productId: id, tagId })) });
        }
      }
    })
    .catch(mapProductConflict);
  await auditProducts(ctx, "product.update", [id], { fields: Object.keys(data) });
  return getProduct(ctx, id);
}

// ─── Status / bulk ──────────────────────────────────────────────────────────

const STATUSES = ["DRAFT", "ACTIVE", "RESERVED", "SOLD", "ARCHIVED", "STOLEN"] as const satisfies readonly ProductStatus[];

/** Why `p` may not go to `status`, or null when allowed. Exported for UI hints. */
export function statusBlocker(p: { price: number; quantity: number }, status: ProductStatus): string | null {
  if (status === "ACTIVE") {
    if (p.price <= 0) return "Price must be above 0";
    if (p.quantity <= 0) return "No stock";
  }
  return null;
}

/**
 * Sets the status of one or more products (all-or-nothing; see rules at the top of this file).
 * Products already in `status` are left untouched. Returns how many changed.
 */
export async function setStatus(ctx: ServiceContext, ids: string[], status: ProductStatus): Promise<{ updated: number }> {
  const data = parseInput(z.object({ ids: idsSchema, status: z.enum(STATUSES) }), { ids, status });
  const changed = await db.$transaction(async (tx) => {
    const rows = await requireProducts(tx, ctx.tenantId, data.ids);
    const failures = rows.flatMap((p) => {
      const reason = p.status === data.status ? null : statusBlocker(p, data.status);
      return reason ? [{ id: p.id, stockCode: p.stockCode, reason }] : [];
    });
    if (failures.length) {
      throw new ServiceError("INVALID", failures.length === 1 ? `#${failures[0].stockCode}: ${failures[0].reason}` : `${failures.length} products cannot be set to ${data.status}`, failures);
    }
    const ids = rows.filter((p) => p.status !== data.status).map((p) => p.id);
    if (!ids.length) return [];
    const now = new Date();
    const where = { tenantId: ctx.tenantId, id: { in: ids } };
    await tx.product.updateMany({ where, data: { status: data.status } });
    if (data.status === "ACTIVE") {
      await tx.product.updateMany({ where: { ...where, publishedAt: null }, data: { publishedAt: now } });
    }
    if (data.status === "ACTIVE" || data.status === "DRAFT") await tx.product.updateMany({ where, data: { soldAt: null } });
    if (data.status === "SOLD") await tx.product.updateMany({ where: { ...where, soldAt: null }, data: { soldAt: now } });
    if (data.status !== "ACTIVE") {
      await tx.reservation.updateMany({
        where: { tenantId: ctx.tenantId, productId: { in: ids }, status: "ACTIVE" },
        data: { status: "RELEASED", releasedAt: now },
      });
    }
    return rows.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, from: p.status }));
  });
  for (const c of changed) {
    await audit({ action: "product.status", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Product", entityId: c.id, data: { from: c.from, to: data.status } });
  }
  return { updated: changed.length };
}

/** "Bump to top": publishedAt = now for the given products (any status). */
export async function bumpToTop(ctx: ServiceContext, ids: string[]): Promise<{ updated: number }> {
  const data = parseInput(idsSchema, ids);
  const updated = await db.$transaction(async (tx) => {
    await requireProducts(tx, ctx.tenantId, data);
    return (await tx.product.updateMany({ where: { tenantId: ctx.tenantId, id: { in: data } }, data: { publishedAt: new Date() } })).count;
  });
  await auditProducts(ctx, "product.bump", data);
  return { updated };
}

const bulkSchema = z
  .object({
    /** Move to this category; null = uncategorised. */
    categoryId: idSchema.nullable().optional(),
    /** e.g. 10 = +10 %, -15 = −15 %; 2 decimals. Result rounded half-up to whole cents (adjustPriceByPercent). */
    priceAdjustPercent: z.number().gt(-100).max(1000).optional(),
    tagIdsAdd: z.array(idSchema).max(100).optional(),
    tagIdsRemove: z.array(idSchema).max(100).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

export type BulkUpdateInput = z.input<typeof bulkSchema>;

/** Applies category / price % / tag changes to many products in one transaction (all-or-nothing). */
export async function bulkUpdate(ctx: ServiceContext, ids: string[], input: BulkUpdateInput): Promise<{ updated: number }> {
  const productIds = [...new Set(parseInput(idsSchema, ids))];
  const data = parseInput(bulkSchema, input);
  await db.$transaction(async (tx) => {
    const rows = await requireProducts(tx, ctx.tenantId, productIds);
    await assertRefs(tx, ctx.tenantId, { categoryId: data.categoryId, tagIds: [...(data.tagIdsAdd ?? []), ...(data.tagIdsRemove ?? [])] });
    const where = { tenantId: ctx.tenantId, id: { in: productIds } };
    if (data.categoryId !== undefined) await tx.product.updateMany({ where, data: { categoryId: data.categoryId } });
    if (data.priceAdjustPercent !== undefined && data.priceAdjustPercent !== 0) {
      const pct = data.priceAdjustPercent;
      const failures = rows
        .filter((p) => p.status === "ACTIVE" && adjustPriceByPercent(p.price, pct) <= 0)
        .map((p) => ({ id: p.id, stockCode: p.stockCode, reason: "Price would become 0" }));
      if (failures.length) throw new ServiceError("INVALID", "Price adjustment would make active products free", failures);
      for (const p of rows) {
        const price = adjustPriceByPercent(p.price, pct);
        if (price !== p.price) await tx.product.update({ where: { id: p.id }, data: { price } });
      }
    }
    if (data.tagIdsRemove?.length) {
      await tx.productTag.deleteMany({ where: { tenantId: ctx.tenantId, productId: { in: productIds }, tagId: { in: data.tagIdsRemove } } });
    }
    if (data.tagIdsAdd?.length) {
      const tagIds = [...new Set(data.tagIdsAdd)];
      await tx.productTag.createMany({
        data: productIds.flatMap((productId) => tagIds.map((tagId) => ({ tenantId: ctx.tenantId, productId, tagId }))),
        skipDuplicates: true,
      });
    }
  });
  await auditProducts(ctx, "product.bulk_update", productIds, data as Prisma.InputJsonValue);
  return { updated: productIds.length };
}

// ─── Delete ─────────────────────────────────────────────────────────────────

/**
 * Hard-deletes a DRAFT that has no order lines and no stock history beyond its opening movement.
 * Anything else → CONFLICT ("archive instead"). Returns the image storage keys so the caller can
 * remove the files (DB rows cascade; files on disk are the media module's job).
 */
export async function deleteProduct(ctx: ServiceContext, id: string): Promise<{ stockCode: number; imageStorageKeys: string[] }> {
  const result = await db.$transaction(async (tx) => {
    const p = await tx.product.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { stockCode: true, status: true, images: { select: { storageKey: true } }, _count: { select: { orderLines: true, stockMovements: true } } },
    });
    if (!p) throw notFound("Product");
    if (p.status !== "DRAFT") throw new ServiceError("CONFLICT", "Only drafts can be deleted; archive this product instead");
    if (p._count.orderLines > 0) throw new ServiceError("CONFLICT", "Product appears on orders; archive it instead");
    if (p._count.stockMovements > 1) throw new ServiceError("CONFLICT", "Product has stock history; archive it instead");
    await tx.product.delete({ where: { id } });
    return { stockCode: p.stockCode, imageStorageKeys: p.images.map((i) => i.storageKey) };
  });
  await auditProducts(ctx, "product.delete", [id], { stockCode: result.stockCode });
  return result;
}
