import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { parseInput, isUniqueViolation } from "@/server/catalog/errors";
import { nextSequenceValue } from "@/server/sequence";
import { recordMovement } from "@/server/stock/ledger";
import { finalizeOrderTx } from "@/server/orders/commands";
import { findOrCreateGuestCustomer } from "@/server/customers";
import { imageUrl, variantKey } from "@/server/media/product-images";
import { hostToBaseUrl } from "@/server/mail/urls";
import { getTenantDisplay } from "@/server/tenant-display";
import type { Prisma } from "@/generated/prisma/client";
import type { FairStatus, PaymentStatus, ProductStatus } from "@/generated/prisma/enums";
import {
  CLIENT_REF_PATTERN,
  FAIR_PAYMENT_METHODS,
  computeFairReport,
  defaultFloorPrice,
  effectiveFloor,
  type FairReport,
  type FairSaleFact,
} from "./pure";

export * from "./pure";

/*
 * Fair mode (docs/fair-mode.md, decisions "Innovatieronde 2").
 *
 *  PREPARING → LIVE → ENDED. Items are FairItems (one per product per fair, with a floor price).
 *  - While a fair is LIVE with `hideFromShop`, its unsold items carry Product.fairHoldId: the
 *    storefront doesn't list them and carts can't reserve them. Ending the fair (or taking the item
 *    off) clears the hold; unsold items never left ACTIVE, so they are back in the shop at once.
 *  - A fair sale is a normal order (channel FAIR) created in ONE transaction. Payment is only
 *    registered (own card reader / cash, no terminal integration): card and cash → MANUAL Payment
 *    + PAID + the shared finalizer (stock SALE, SOLD, mails, invoice job). Invoice → PENDING; the
 *    item leaves the stand, so stock is booked out now and the finalizer (on "mark as paid") skips it.
 *  - `clientRef` (Order @@unique tenantId+clientRef) makes the offline sync idempotent: a retried
 *    sale returns the order it already created.
 *  - Cache: every mutation is audited as "fair.*", which invalidates the shop catalog tag.
 */

type Tx = Prisma.TransactionClient;

const idSchema = z.string().trim().min(1).max(64);
const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Enter a valid date");
const moneySchema = z.int().min(0).max(100_000_000);

const fairSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a name").max(120),
    startsOn: dateSchema,
    endsOn: dateSchema.nullish(),
    hideFromShop: z.boolean().default(true),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { path: ["endsOn"], message: "The last day can't be before the first day" });
export type FairInput = z.input<typeof fairSchema>;

const ACTOR = (ctx: ServiceContext) => ({ tenantId: ctx.tenantId, actorId: ctx.actor.id });

async function lockFair(tx: Tx, tenantId: string, fairId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fairs WHERE id = ${fairId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (rows.length === 0) throw new ServiceError("NOT_FOUND", "Fair not found");
  return tx.fair.findUniqueOrThrow({ where: { id: fairId } });
}

/** Holds this fair's unsold, still-for-sale items (not held by another fair). Returns the count. */
async function applyHolds(tx: Tx, tenantId: string, fairId: string, productIds?: string[]) {
  const res = await tx.product.updateMany({
    where: {
      tenantId,
      status: "ACTIVE",
      fairHoldId: null,
      fairItems: { some: { fairId, soldAt: null } },
      ...(productIds ? { id: { in: productIds } } : {}),
    },
    data: { fairHoldId: fairId },
  });
  return res.count;
}

/** Releases this fair's holds (all, or only `productIds`). Returns the count. */
async function clearHolds(tx: Tx, tenantId: string, fairId: string, productIds?: string[]) {
  const res = await tx.product.updateMany({
    where: { tenantId, fairHoldId: fairId, ...(productIds ? { id: { in: productIds } } : {}) },
    data: { fairHoldId: null },
  });
  return res.count;
}

// ─── Queries ────────────────────────────────────────────────────────────────

export type FairRow = {
  id: string;
  name: string;
  status: FairStatus;
  startsOn: Date;
  endsOn: Date | null;
  hideFromShop: boolean;
  itemCount: number;
  soldCount: number;
  revenue: number;
};

export async function listFairs(ctx: ServiceContext): Promise<FairRow[]> {
  const fairs = await db.fair.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, status: true, startsOn: true, endsOn: true, hideFromShop: true },
    take: 500,
  });
  if (!fairs.length) return [];
  const ids = fairs.map((f) => f.id);
  const [items, sold] = await Promise.all([
    db.fairItem.groupBy({ by: ["fairId"], where: { tenantId: ctx.tenantId, fairId: { in: ids } }, _count: { _all: true } }),
    db.fairItem.groupBy({ by: ["fairId"], where: { tenantId: ctx.tenantId, fairId: { in: ids }, soldAt: { not: null } }, _count: { _all: true }, _sum: { soldPrice: true } }),
  ]);
  const itemsBy = new Map(items.map((r) => [r.fairId, r._count._all]));
  const soldBy = new Map(sold.map((r) => [r.fairId, r]));
  return fairs.map((f) => ({
    ...f,
    itemCount: itemsBy.get(f.id) ?? 0,
    soldCount: soldBy.get(f.id)?._count._all ?? 0,
    revenue: soldBy.get(f.id)?._sum.soldPrice ?? 0,
  }));
}

export type FairItemRow = {
  id: string;
  productId: string;
  stockCode: number;
  title: string;
  listPrice: number;
  purchasePrice: number | null;
  floorPrice: number | null;
  productStatus: ProductStatus;
  held: boolean;
  /** Held by ANOTHER live fair (can't be sold here until that one ends). */
  heldElsewhere: boolean;
  thumb: string | null;
  soldPrice: number | null;
  soldAt: Date | null;
  orderId: string | null;
};

export type FairDetail = {
  id: string;
  name: string;
  status: FairStatus;
  startsOn: Date;
  endsOn: Date | null;
  hideFromShop: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  notes: string | null;
  items: FairItemRow[];
};

export async function getFair(ctx: ServiceContext, fairId: string): Promise<FairDetail> {
  const id = idSchema.parse(fairId);
  const fair = await db.fair.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: {
      items: {
        orderBy: [{ product: { stockCode: "asc" } }],
        include: {
          product: {
            select: {
              id: true,
              stockCode: true,
              title: true,
              price: true,
              purchasePrice: true,
              status: true,
              fairHoldId: true,
              images: { select: { storageKey: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1 },
            },
          },
        },
      },
    },
  });
  if (!fair) throw new ServiceError("NOT_FOUND", "Fair not found");
  return {
    id: fair.id,
    name: fair.name,
    status: fair.status,
    startsOn: fair.startsOn,
    endsOn: fair.endsOn,
    hideFromShop: fair.hideFromShop,
    startedAt: fair.startedAt,
    endedAt: fair.endedAt,
    notes: fair.notes,
    items: fair.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      stockCode: i.product.stockCode,
      title: i.product.title,
      listPrice: i.product.price,
      purchasePrice: i.product.purchasePrice,
      floorPrice: i.floorPrice,
      productStatus: i.product.status,
      held: i.product.fairHoldId === fair.id,
      heldElsewhere: i.product.fairHoldId !== null && i.product.fairHoldId !== fair.id,
      thumb: i.product.images[0] ? imageUrl(i.product.images[0].storageKey, "thumb") : null,
      soldPrice: i.soldPrice,
      soldAt: i.soldAt,
      orderId: i.orderId,
    })),
  };
}

export type FairCandidate = { id: string; stockCode: number; title: string; price: number; thumb: string | null };

/** ACTIVE, in-stock products not yet on this fair, matching `q` (title / stock number / SKU). */
export async function searchFairCandidates(ctx: ServiceContext, fairId: string, q: string, limit = 30): Promise<FairCandidate[]> {
  const id = idSchema.parse(fairId);
  const query = z.string().trim().max(100).parse(q ?? "");
  const code = /^\d{1,9}$/.test(query) ? Number(query) : null;
  const rows = await db.product.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: "ACTIVE",
      quantity: { gt: 0 },
      fairItems: { none: { fairId: id } },
      ...(query
        ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }, ...(code ? [{ stockCode: code }] : [])] }
        : {}),
    },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { stockCode: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true, stockCode: true, title: true, price: true, images: { select: { storageKey: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1 } },
  });
  return rows.map((r) => ({ id: r.id, stockCode: r.stockCode, title: r.title, price: r.price, thumb: r.images[0] ? imageUrl(r.images[0].storageKey, "thumb") : null }));
}

// ─── Fair lifecycle ─────────────────────────────────────────────────────────

export async function createFair(ctx: ServiceContext, input: FairInput) {
  const data = parseInput(fairSchema, input);
  const fair = await db.fair.create({
    data: { tenantId: ctx.tenantId, name: data.name, startsOn: data.startsOn, endsOn: data.endsOn ?? null, hideFromShop: data.hideFromShop, notes: data.notes || null },
    select: { id: true, name: true },
  });
  await audit({ action: "fair.create", ...ACTOR(ctx), entity: "Fair", entityId: fair.id, data: { name: fair.name } });
  return fair;
}

/** Edits name/dates/notes/hide toggle. On a LIVE fair the hide toggle applies or releases holds immediately. */
export async function updateFair(ctx: ServiceContext, fairId: string, input: FairInput) {
  const id = idSchema.parse(fairId);
  const data = parseInput(fairSchema, input);
  const result = await db.$transaction(async (tx) => {
    const fair = await lockFair(tx, ctx.tenantId, id);
    await tx.fair.update({
      where: { id },
      data: { name: data.name, startsOn: data.startsOn, endsOn: data.endsOn ?? null, hideFromShop: data.hideFromShop, notes: data.notes || null },
    });
    let held = 0;
    let released = 0;
    if (fair.status === "LIVE" && fair.hideFromShop !== data.hideFromShop) {
      if (data.hideFromShop) held = await applyHolds(tx, ctx.tenantId, id);
      else released = await clearHolds(tx, ctx.tenantId, id);
    }
    return { held, released };
  });
  await audit({ action: "fair.update", ...ACTOR(ctx), entity: "Fair", entityId: id, data: { name: data.name, hideFromShop: data.hideFromShop, ...result } });
  return result;
}

/** Deletes a fair that never went live (no sales possible yet). */
export async function deleteFair(ctx: ServiceContext, fairId: string) {
  const id = idSchema.parse(fairId);
  const name = await db.$transaction(async (tx) => {
    const fair = await lockFair(tx, ctx.tenantId, id);
    if (fair.status !== "PREPARING") throw new ServiceError("CONFLICT", "Only fairs that never went live can be deleted");
    await tx.fair.delete({ where: { id } });
    return fair.name;
  });
  await audit({ action: "fair.delete", ...ACTOR(ctx), entity: "Fair", entityId: id, data: { name } });
}

/** PREPARING → LIVE. Hides the unsold items from the shop when `hideFromShop`. */
export async function startFair(ctx: ServiceContext, fairId: string) {
  const id = idSchema.parse(fairId);
  const held = await db.$transaction(async (tx) => {
    const fair = await lockFair(tx, ctx.tenantId, id);
    if (fair.status !== "PREPARING") throw new ServiceError("CONFLICT", fair.status === "LIVE" ? "The fair is already live" : "The fair has ended");
    await tx.fair.update({ where: { id }, data: { status: "LIVE", startedAt: new Date() } });
    return fair.hideFromShop ? applyHolds(tx, ctx.tenantId, id) : 0;
  });
  await audit({ action: "fair.start", ...ACTOR(ctx), entity: "Fair", entityId: id, data: { held } });
  return { held };
}

/** LIVE → ENDED. Releases every hold: unsold items are for sale in the shop again right away. */
export async function endFair(ctx: ServiceContext, fairId: string) {
  const id = idSchema.parse(fairId);
  const released = await db.$transaction(async (tx) => {
    const fair = await lockFair(tx, ctx.tenantId, id);
    if (fair.status !== "LIVE") throw new ServiceError("CONFLICT", fair.status === "ENDED" ? "The fair has already ended" : "The fair hasn't started");
    await tx.fair.update({ where: { id }, data: { status: "ENDED", endedAt: new Date() } });
    return clearHolds(tx, ctx.tenantId, id);
  });
  await audit({ action: "fair.end", ...ACTOR(ctx), entity: "Fair", entityId: id, data: { released } });
  return { released };
}

// ─── Items ──────────────────────────────────────────────────────────────────

const addItemsSchema = z.object({ productIds: z.array(idSchema).min(1, "Choose at least one item").max(500) });

/**
 * Puts products on the fair (only ACTIVE, in stock; others are skipped and reported). The floor
 * defaults to list −15%, rounded. On a LIVE hiding fair the new items are held immediately.
 */
export async function addFairItems(ctx: ServiceContext, fairId: string, productIds: string[]) {
  const id = idSchema.parse(fairId);
  const { productIds: ids } = parseInput(addItemsSchema, { productIds });
  const result = await db.$transaction(async (tx) => {
    const fair = await lockFair(tx, ctx.tenantId, id);
    if (fair.status === "ENDED") throw new ServiceError("CONFLICT", "The fair has ended");
    const products = await tx.product.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [...new Set(ids)] }, status: "ACTIVE", quantity: { gt: 0 } },
      select: { id: true, price: true },
    });
    const created = await tx.fairItem.createMany({
      data: products.map((p) => ({ tenantId: ctx.tenantId, fairId: id, productId: p.id, floorPrice: defaultFloorPrice(p.price) })),
      skipDuplicates: true,
    });
    const held = fair.status === "LIVE" && fair.hideFromShop ? await applyHolds(tx, ctx.tenantId, id, products.map((p) => p.id)) : 0;
    return { added: created.count, skipped: new Set(ids).size - created.count, held };
  });
  await audit({ action: "fair.items_add", ...ACTOR(ctx), entity: "Fair", entityId: id, data: result });
  return result;
}

/** Takes an unsold item off the fair (and out of its hold). */
export async function removeFairItem(ctx: ServiceContext, fairId: string, productId: string) {
  const id = idSchema.parse(fairId);
  const pid = idSchema.parse(productId);
  await db.$transaction(async (tx) => {
    await lockFair(tx, ctx.tenantId, id);
    const item = await tx.fairItem.findFirst({ where: { tenantId: ctx.tenantId, fairId: id, productId: pid } });
    if (!item) throw new ServiceError("NOT_FOUND", "Item is not on this fair");
    if (item.soldAt) throw new ServiceError("CONFLICT", "This item was sold at the fair");
    await tx.fairItem.delete({ where: { id: item.id } });
    await clearHolds(tx, ctx.tenantId, id, [pid]);
  });
  await audit({ action: "fair.items_remove", ...ACTOR(ctx), entity: "Fair", entityId: id, data: { productId: pid } });
}

/** Sets (or clears: null = list price is the minimum) an item's floor price. */
export async function setFairItemFloor(ctx: ServiceContext, fairId: string, productId: string, floorPrice: number | null) {
  const id = idSchema.parse(fairId);
  const pid = idSchema.parse(productId);
  const floor = moneySchema.nullable().parse(floorPrice);
  const item = await db.fairItem.findFirst({ where: { tenantId: ctx.tenantId, fairId: id, productId: pid }, select: { id: true, soldAt: true, product: { select: { price: true } } } });
  if (!item) throw new ServiceError("NOT_FOUND", "Item is not on this fair");
  if (item.soldAt) throw new ServiceError("CONFLICT", "This item was sold at the fair");
  if (floor !== null && floor > item.product.price) throw new ServiceError("INVALID", "The floor can't be above the list price");
  await db.fairItem.update({ where: { id: item.id }, data: { floorPrice: floor } });
  await audit({ action: "fair.item_floor", ...ACTOR(ctx), entity: "Fair", entityId: id, data: { productId: pid, floorPrice: floor } });
}

// ─── Selling ────────────────────────────────────────────────────────────────

/** What the fair-mode client caches on load, so lookups keep working offline. */
export type FairSellData = {
  fair: { id: string; name: string; status: FairStatus; hideFromShop: boolean; startsOn: string };
  currency: string;
  items: {
    productId: string;
    stockCode: number;
    title: string;
    listPrice: number;
    purchasePrice: number | null;
    floor: number;
    thumb: string | null;
    sold: boolean;
    available: boolean;
  }[];
};

export async function getFairSellData(ctx: ServiceContext, fairId: string): Promise<FairSellData> {
  const fair = await getFair(ctx, fairId);
  const display = await getTenantDisplay(ctx.tenantId);
  return {
    fair: { id: fair.id, name: fair.name, status: fair.status, hideFromShop: fair.hideFromShop, startsOn: fair.startsOn.toISOString().slice(0, 10) },
    currency: display?.currency ?? "EUR",
    items: fair.items.map((i) => ({
      productId: i.productId,
      stockCode: i.stockCode,
      title: i.title,
      listPrice: i.listPrice,
      purchasePrice: i.purchasePrice,
      floor: effectiveFloor(i.floorPrice, i.listPrice),
      thumb: i.thumb,
      sold: i.soldAt !== null,
      available: i.soldAt === null && i.productStatus === "ACTIVE" && !i.heldElsewhere,
    })),
  };
}

const saleSchema = z.object({
  fairId: idSchema,
  productId: idSchema,
  price: z.int().min(1, "Enter a price").max(100_000_000),
  method: z.enum(FAIR_PAYMENT_METHODS),
  buyerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === "" || (z.email().safeParse(v).success && !v.endsWith(".invalid")), "Enter a valid email address")
    .nullish(),
  buyerName: z.string().trim().max(120).nullish(),
  clientRef: z.string().regex(CLIENT_REF_PATTERN, "Invalid client reference"),
  /** Explicit staff confirmation to sell below the floor. */
  allowBelowFloor: z.boolean().default(false),
  /** When the sale was confirmed on the device (offline sales sync later). */
  soldAt: z.iso.datetime({ offset: true }).nullish(),
});
export type FairSaleInput = z.input<typeof saleSchema>;

export type FairSaleResult = {
  orderId: string;
  orderNumber: number;
  paymentStatus: PaymentStatus;
  /** true = this clientRef was synced before; the existing order is returned. */
  reused: boolean;
};

/** Placeholder address for sales without a buyer email: RFC 2606 ".invalid" — mails to it are skipped. */
export const FAIR_NO_EMAIL = "fair-buyer@fair.invalid";

/** Device time for an offline sale, trusted only within the last 7 days and not in the future. */
function saleTime(soldAt: string | null | undefined, now: Date): Date {
  if (!soldAt) return now;
  const t = new Date(soldAt);
  if (t > now || now.getTime() - t.getTime() > 7 * 24 * 60 * 60 * 1000) return now;
  return t;
}

async function existingSale(tx: Tx | typeof db, tenantId: string, clientRef: string): Promise<FairSaleResult | null> {
  const o = await tx.order.findUnique({ where: { tenantId_clientRef: { tenantId, clientRef } }, select: { id: true, number: true, paymentStatus: true } });
  return o ? { orderId: o.id, orderNumber: o.number, paymentStatus: o.paymentStatus, reused: true } : null;
}

/**
 * Records a sale at the stand as an order, in ONE transaction (see the module comment).
 * Errors the client shows as-is: NOT_FOUND (item not on this fair), CONFLICT (already sold, reserved
 * by a web order, on another fair, fair not live), INVALID (price below floor without override).
 */
export async function recordFairSale(ctx: ServiceContext, input: FairSaleInput): Promise<FairSaleResult> {
  const data = parseInput(saleSchema, input);
  const tenantId = ctx.tenantId;

  const pre = await existingSale(db, tenantId, data.clientRef);
  if (pre) return pre;

  let result: FairSaleResult & { stockCode: number; belowFloor: boolean };
  try {
    result = await db.$transaction(
      async (tx) => {
        const fair = await tx.fair.findFirst({ where: { id: data.fairId, tenantId }, select: { id: true, name: true, status: true } });
        if (!fair) throw new ServiceError("NOT_FOUND", "Fair not found");
        // An ENDED fair still accepts sales queued offline before it ended (they carry a clientRef).
        if (fair.status === "PREPARING") throw new ServiceError("CONFLICT", "Start the fair before selling");

        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM products WHERE id = ${data.productId} AND "tenantId" = ${tenantId} FOR UPDATE`;
        if (locked.length === 0) throw new ServiceError("NOT_FOUND", "Item not found");
        // Re-check under the product lock: a concurrent retry of the same sale committed meanwhile.
        const dup = await existingSale(tx, tenantId, data.clientRef);
        if (dup) return { ...dup, stockCode: 0, belowFloor: false };

        const product = await tx.product.findUniqueOrThrow({
          where: { id: data.productId },
          select: { id: true, stockCode: true, sku: true, title: true, price: true, purchasePrice: true, status: true, quantity: true, fairHoldId: true },
        });
        const item = await tx.fairItem.findUnique({ where: { fairId_productId: { fairId: fair.id, productId: product.id } } });
        if (!item) throw new ServiceError("NOT_FOUND", `No. ${product.stockCode} is not on this fair`);
        if (item.soldAt || product.status === "SOLD" || product.quantity <= 0) {
          throw new ServiceError("CONFLICT", `No. ${product.stockCode} is already sold`, { reason: "sold" });
        }
        if (product.status !== "ACTIVE") throw new ServiceError("CONFLICT", `No. ${product.stockCode} is not for sale (${product.status.toLowerCase()})`, { reason: "unavailable" });
        if (product.fairHoldId && product.fairHoldId !== fair.id) throw new ServiceError("CONFLICT", `No. ${product.stockCode} is on another fair`, { reason: "other_fair" });
        const now = new Date();
        const webOrderHold = await tx.reservation.findFirst({
          where: { tenantId, productId: product.id, status: "ACTIVE", expiresAt: { gt: now }, orderId: { not: null } },
          select: { id: true },
        });
        if (webOrderHold) throw new ServiceError("CONFLICT", `No. ${product.stockCode} is reserved by a webshop order awaiting payment`, { reason: "reserved" });

        const floor = effectiveFloor(item.floorPrice, product.price);
        const belowFloor = data.price < floor;
        if (belowFloor && !data.allowBelowFloor) {
          throw new ServiceError("INVALID", "The price is below the floor you set", [{ path: "price", message: "The price is below the floor you set" }]);
        }

        const email = data.buyerEmail || null;
        const customer = email ? await findOrCreateGuestCustomer(tx, tenantId, { email, name: data.buyerName || null }) : null;
        const display = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
        const cover = await tx.productImage.findFirst({
          where: { tenantId, productId: product.id },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { storageKey: true },
        });
        const placedAt = saleTime(data.soldAt, now);
        const paid = data.method !== "invoice";
        const number = await nextSequenceValue(tx, tenantId, "order.number");
        const order = await tx.order.create({
          data: {
            tenantId,
            number,
            customerId: customer?.id ?? null,
            email: email ?? FAIR_NO_EMAIL,
            customerName: data.buyerName || (customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") : "") || "Fair buyer",
            currency: display.currency,
            subtotal: data.price,
            total: data.price,
            channel: "FAIR",
            fairId: fair.id,
            clientRef: data.clientRef,
            paymentStatus: paid ? "PAID" : "PENDING",
            paidAt: paid ? now : null,
            paymentMethod: data.method,
            shippingMethod: "PICKUP", // handed over at the stand
            shippingZoneName: fair.name,
            placedAt,
            lines: {
              create: [
                {
                  tenantId,
                  productId: product.id,
                  title: product.title,
                  stockCode: product.stockCode,
                  sku: product.sku,
                  imagePath: cover ? variantKey(cover.storageKey, "thumb") : null,
                  unitPrice: data.price,
                  quantity: 1,
                  lineTotal: data.price,
                  purchasePriceSnapshot: product.purchasePrice,
                },
              ],
            },
          },
          select: { id: true, number: true },
        });
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId: order.id,
            type: "created",
            actorId: ctx.actor.id,
            data: {
              source: "fair",
              fairId: fair.id,
              clientRef: data.clientRef,
              method: data.method,
              listPrice: product.price,
              floor,
              belowFloor,
              deviceTime: data.soldAt ?? null,
            },
          },
        });

        if (paid) {
          const payment = await tx.payment.create({
            data: { tenantId, orderId: order.id, provider: "MANUAL", method: data.method, status: "PAID", amount: data.price, currency: display.currency, paidAt: now },
          });
          await tx.orderEvent.create({
            data: { tenantId, orderId: order.id, type: "payment.paid", actorId: ctx.actor.id, data: { from: "PENDING", provider: "MANUAL", paymentId: payment.id, method: data.method } },
          });
          // Same completion as every paid order: stock SALE, SOLD, other holds released, mails, invoice job.
          await finalizeOrderTx(tx, tenantId, order.id, { source: "fair", actorId: ctx.actor.id });
        } else {
          // Invoice: the buyer takes the item now and pays later. Book it out here; "mark as paid"
          // later finalizes the order (mails, invoice) without booking the stock a second time.
          await recordMovement(tx, { tenantId, productId: product.id, delta: -1, reason: "SALE", orderId: order.id, actorId: ctx.actor.id, note: `Fair sale · order #${order.number}` });
          const after = await tx.product.findUniqueOrThrow({ where: { id: product.id }, select: { quantity: true } });
          if (after.quantity === 0) {
            await tx.product.update({ where: { id: product.id }, data: { status: "SOLD", soldAt: now } });
            await tx.reservation.updateMany({ where: { tenantId, productId: product.id, status: "ACTIVE" }, data: { status: "RELEASED", releasedAt: now } });
          }
        }
        await tx.product.update({ where: { id: product.id }, data: { fairHoldId: null } });
        await tx.fairItem.update({ where: { id: item.id }, data: { soldPrice: data.price, soldAt: placedAt, orderId: order.id } });
        return { orderId: order.id, orderNumber: order.number, paymentStatus: (paid ? "PAID" : "PENDING") as PaymentStatus, reused: false, stockCode: product.stockCode, belowFloor };
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    // Two deliveries of the same sale raced past the pre-check: the loser returns the winner's order.
    if (isUniqueViolation(err, "clientRef")) {
      const again = await existingSale(db, tenantId, data.clientRef);
      if (again) return again;
    }
    throw err;
  }

  const { stockCode, belowFloor, ...sale } = result;
  if (!sale.reused) {
    await audit({
      action: "fair.sale",
      ...ACTOR(ctx),
      entity: "Order",
      entityId: sale.orderId,
      data: { fairId: data.fairId, stockCode, price: data.price, method: data.method, belowFloor, clientRef: data.clientRef },
    });
  }
  return sale;
}

// ─── Report ─────────────────────────────────────────────────────────────────

/** Live / end-of-fair figures: the fair's orders that were not canceled. */
export async function getFairReport(ctx: ServiceContext, fairId: string): Promise<FairReport & { unsold: number; items: number }> {
  const id = idSchema.parse(fairId);
  const [orders, items, sold] = await Promise.all([
    db.order.findMany({
      where: { tenantId: ctx.tenantId, fairId: id, canceledAt: null },
      select: {
        id: true,
        number: true,
        paymentMethod: true,
        placedAt: true,
        lines: { select: { title: true, stockCode: true, unitPrice: true, quantity: true, purchasePriceSnapshot: true, product: { select: { price: true } } } },
      },
    }),
    db.fairItem.count({ where: { tenantId: ctx.tenantId, fairId: id } }),
    db.fairItem.count({ where: { tenantId: ctx.tenantId, fairId: id, soldAt: { not: null } } }),
  ]);
  const facts: FairSaleFact[] = orders.flatMap((o) =>
    o.lines.map((l) => ({
      orderId: o.id,
      orderNumber: o.number,
      stockCode: l.stockCode ?? 0,
      title: l.title,
      price: l.unitPrice * l.quantity,
      listPrice: (l.product?.price ?? l.unitPrice) * l.quantity,
      purchasePrice: l.purchasePriceSnapshot == null ? null : l.purchasePriceSnapshot * l.quantity,
      method: o.paymentMethod,
      soldAt: o.placedAt,
    })),
  );
  return { ...computeFairReport(facts), items, unsold: items - sold };
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export type FairLabel = { stockCode: number; title: string; price: number; url: string };

/**
 * Label data for the fair's unsold items (or the given product ids). The QR encodes the public
 * product URL on the shop's primary domain; fair mode reads the stock code from that URL.
 */
export async function getFairLabels(ctx: ServiceContext, fairId: string, productIds?: string[]): Promise<{ fairName: string; currency: string; labels: FairLabel[] }> {
  const fair = await getFair(ctx, fairId);
  const display = await getTenantDisplay(ctx.tenantId);
  const base = display?.primaryHost ? hostToBaseUrl(display.primaryHost) : (process.env.APP_URL ?? "").replace(/\/$/, "");
  const only = productIds?.length ? new Set(productIds) : null;
  return {
    fairName: fair.name,
    currency: display?.currency ?? "EUR",
    labels: fair.items
      .filter((i) => !i.soldAt && (!only || only.has(i.productId)))
      .map((i) => ({ stockCode: i.stockCode, title: i.title, price: i.listPrice, url: `${base}/product/${i.stockCode}` })),
  };
}
