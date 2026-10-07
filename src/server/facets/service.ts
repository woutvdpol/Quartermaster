import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { isUniqueViolation, notFound, parseInput } from "@/server/catalog/errors";
import { nextFreeSlug, slugify } from "@/server/catalog/slug";
import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_FACETS, type DefaultValue } from "./defaults";
import { FACET_KINDS, buildValueTree, isSelfOrDescendant, valuePaths, type FacetKindName, type ValueNode } from "./tree";

/*
 * Facet taxonomy admin services (period · country · branch · unit · type · maker · custom).
 *
 *  - Facets are per tenant (slug unique per tenant); values form a tree per facet (slug unique per
 *    facet). Value-tree mutations take a per-facet advisory lock so concurrent moves cannot build a
 *    cycle. Deleting a value moves its children up to its parent.
 *  - Product assignments (ProductFacetValue) are plain links; the shop treats a selected value as
 *    "this value or any descendant".
 *  - Every mutation audits with an action starting with "facet." (the shop catalog cache is
 *    invalidated through src/server/storefront/cache.ts shopTagsForAction).
 */

type Tx = Prisma.TransactionClient;

const MAX_IDS = 500;
const id = z.string().min(1).max(64);
const ids = z.array(id).min(1).max(MAX_IDS);
const nameSchema = z.string().trim().min(1).max(100);
const slugInput = z.string().trim().max(80).optional();

// ─── Types ──────────────────────────────────────────────────────────────────

export type FacetSummary = {
  id: string;
  kind: FacetKindName;
  name: string;
  slug: string;
  sortOrder: number;
  isFilterable: boolean;
  valueCount: number;
  /** Distinct products with at least one value of this facet (any status). */
  productCount: number;
};

export type FacetValueRow = {
  id: string;
  facetId: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  legacyTagId: number | null;
  /** Products linked to this value directly (any status). */
  productCount: number;
};

export type FacetWithValues = FacetSummary & { values: FacetValueRow[]; tree: ValueNode<FacetValueRow>[] };

/** Taxonomy for pickers (product editor): every facet with its value tree and " › " paths. */
export type TaxonomyFacet = {
  id: string;
  kind: FacetKindName;
  name: string;
  slug: string;
  values: { id: string; parentId: string | null; name: string; slug: string; depth: number; path: string }[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function lockFacet(tx: Tx, facetId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"facet-values:" + facetId}))`;
}

async function lockTenantFacets(tx: Tx, tenantId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"facets:" + tenantId}))`;
}

async function requireFacet(tx: Tx, tenantId: string, facetId: string) {
  const facet = await tx.facet.findFirst({ where: { id: facetId, tenantId } });
  if (!facet) throw notFound("Facet");
  return facet;
}

async function requireValue(tx: Tx, tenantId: string, valueId: string) {
  const value = await tx.facetValue.findFirst({ where: { id: valueId, tenantId } });
  if (!value) throw notFound("Facet value");
  return value;
}

async function uniqueFacetSlug(tx: Tx, tenantId: string, wanted: string, excludeId?: string) {
  const base = slugify(wanted) || "facet";
  const rows = await tx.facet.findMany({
    where: { tenantId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { slug: true },
  });
  return nextFreeSlug(base, rows.map((r) => r.slug));
}

async function uniqueValueSlug(tx: Tx, facetId: string, wanted: string, excludeId?: string) {
  const base = slugify(wanted) || "value";
  const rows = await tx.facetValue.findMany({
    where: { facetId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { slug: true },
  });
  return nextFreeSlug(base, rows.map((r) => r.slug));
}

async function nextValueSortOrder(tx: Tx, facetId: string, parentId: string | null) {
  const agg = await tx.facetValue.aggregate({ where: { facetId, parentId }, _max: { sortOrder: true } });
  return (agg._max.sortOrder ?? -1) + 1;
}

async function valueParentMap(tx: Tx, facetId: string) {
  const rows = await tx.facetValue.findMany({ where: { facetId }, select: { id: true, parentId: true } });
  return new Map(rows.map((r) => [r.id, r.parentId]));
}

/** A parent must be a value of the same facet and not the value itself or one of its descendants. */
async function assertValidValueParent(tx: Tx, tenantId: string, facetId: string, valueId: string | null, parentId: string | null) {
  if (!parentId) return;
  const parent = await requireValue(tx, tenantId, parentId);
  if (parent.facetId !== facetId) throw new ServiceError("INVALID", "The parent value belongs to another facet");
  if (valueId && isSelfOrDescendant(await valueParentMap(tx, facetId), valueId, parentId)) {
    throw new ServiceError("INVALID", "A value cannot be moved under itself or one of its children");
  }
}

function mapFacetConflict(err: unknown): never {
  if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "A facet with this slug already exists");
  throw err;
}

function mapValueConflict(err: unknown): never {
  if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "A value with this slug already exists in this facet");
  throw err;
}

async function renumberValues(tx: Tx, orderedIds: string[]) {
  for (const [i, vid] of orderedIds.entries()) await tx.facetValue.update({ where: { id: vid }, data: { sortOrder: i } });
}

const log = (ctx: ServiceContext, action: string, entity: string, entityId: string, data?: Prisma.InputJsonValue) =>
  audit({ action, tenantId: ctx.tenantId, actorId: ctx.actor.id, entity, entityId, data });

// ─── Facets ─────────────────────────────────────────────────────────────────

/** All facets ordered by sortOrder, name — with value and (distinct) product counts. */
export async function listFacets(ctx: ServiceContext): Promise<FacetSummary[]> {
  const [facets, valueCounts, productCounts] = await Promise.all([
    db.facet.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.facetValue.groupBy({ by: ["facetId"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    db.$queryRaw<{ facetId: string; n: number }[]>`
      SELECT fv."facetId", count(DISTINCT pfv."productId")::int AS n
      FROM product_facet_values pfv JOIN facet_values fv ON fv.id = pfv."facetValueId"
      WHERE pfv."tenantId" = ${ctx.tenantId}
      GROUP BY fv."facetId"`,
  ]);
  const vc = new Map(valueCounts.map((v) => [v.facetId, v._count._all]));
  const pc = new Map(productCounts.map((p) => [p.facetId, p.n]));
  return facets.map((f) => ({
    id: f.id,
    kind: f.kind,
    name: f.name,
    slug: f.slug,
    sortOrder: f.sortOrder,
    isFilterable: f.isFilterable,
    valueCount: vc.get(f.id) ?? 0,
    productCount: pc.get(f.id) ?? 0,
  }));
}

/** One facet with all values (flat + tree) and direct product counts per value. */
export async function getFacet(ctx: ServiceContext, facetId: string): Promise<FacetWithValues> {
  const summary = (await listFacets(ctx)).find((f) => f.id === facetId);
  if (!summary) throw notFound("Facet");
  const [values, counts] = await Promise.all([
    db.facetValue.findMany({ where: { tenantId: ctx.tenantId, facetId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.productFacetValue.groupBy({ by: ["facetValueId"], where: { tenantId: ctx.tenantId, facetValue: { facetId } }, _count: { _all: true } }),
  ]);
  const cnt = new Map(counts.map((c) => [c.facetValueId, c._count._all]));
  const rows: FacetValueRow[] = values.map((v) => ({
    id: v.id,
    facetId: v.facetId,
    parentId: v.parentId,
    name: v.name,
    slug: v.slug,
    sortOrder: v.sortOrder,
    legacyTagId: v.legacyTagId,
    productCount: cnt.get(v.id) ?? 0,
  }));
  return { ...summary, values: rows, tree: buildValueTree(rows) };
}

/** Every facet with its values as a depth-first list (for pickers). */
export async function getTaxonomy(ctx: ServiceContext): Promise<TaxonomyFacet[]> {
  const [facets, values] = await Promise.all([
    db.facet.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.facetValue.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, facetId: true, parentId: true, name: true, slug: true, sortOrder: true } }),
  ]);
  return facets.map((f) => {
    const own = values.filter((v) => v.facetId === f.id);
    const paths = valuePaths(own);
    const flat: TaxonomyFacet["values"] = [];
    const walk = (nodes: ValueNode<(typeof own)[number]>[]) => {
      for (const n of nodes) {
        flat.push({ id: n.id, parentId: n.parentId, name: n.name, slug: n.slug, depth: n.depth, path: (paths.get(n.id) ?? [n.name]).join(" › ") });
        walk(n.children);
      }
    };
    walk(buildValueTree(own));
    return { id: f.id, kind: f.kind, name: f.name, slug: f.slug, values: flat };
  });
}

const createFacetSchema = z.object({
  kind: z.enum(FACET_KINDS),
  name: nameSchema,
  slug: slugInput,
  isFilterable: z.boolean().optional(),
});
export type CreateFacetInput = z.input<typeof createFacetSchema>;

/** Creates a facet as the last one. Slug from `slug` or name, de-duplicated. */
export async function createFacet(ctx: ServiceContext, input: CreateFacetInput) {
  const data = parseInput(createFacetSchema, input);
  const facet = await db
    .$transaction(async (tx) => {
      await lockTenantFacets(tx, ctx.tenantId);
      const agg = await tx.facet.aggregate({ where: { tenantId: ctx.tenantId }, _max: { sortOrder: true } });
      return tx.facet.create({
        data: {
          tenantId: ctx.tenantId,
          kind: data.kind,
          name: data.name,
          slug: await uniqueFacetSlug(tx, ctx.tenantId, data.slug || data.name),
          isFilterable: data.isFilterable ?? true,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
        },
      });
    })
    .catch(mapFacetConflict);
  await log(ctx, "facet.create", "Facet", facet.id, { name: facet.name, kind: facet.kind });
  return facet;
}

const updateFacetSchema = z.object({
  kind: z.enum(FACET_KINDS).optional(),
  name: nameSchema.optional(),
  slug: slugInput,
  regenerateSlug: z.boolean().optional(),
  isFilterable: z.boolean().optional(),
});
export type UpdateFacetInput = z.input<typeof updateFacetSchema>;

/** Updates a facet. The slug changes only with an explicit `slug` (CONFLICT when taken) or `regenerateSlug`. */
export async function updateFacet(ctx: ServiceContext, facetId: string, patch: UpdateFacetInput) {
  const data = parseInput(updateFacetSchema, patch);
  const facet = await db
    .$transaction(async (tx) => {
      const current = await requireFacet(tx, ctx.tenantId, facetId);
      const update: Prisma.FacetUncheckedUpdateInput = {};
      if (data.kind) update.kind = data.kind;
      if (data.name !== undefined) update.name = data.name;
      if (data.isFilterable !== undefined) update.isFilterable = data.isFilterable;
      if (data.slug) {
        const slug = slugify(data.slug);
        if (!slug) throw new ServiceError("INVALID", "Slug is empty");
        update.slug = slug;
      } else if (data.regenerateSlug) {
        update.slug = await uniqueFacetSlug(tx, ctx.tenantId, data.name ?? current.name, facetId);
      }
      return tx.facet.update({ where: { id: facetId }, data: update });
    })
    .catch(mapFacetConflict);
  await log(ctx, "facet.update", "Facet", facetId, { fields: Object.keys(data) });
  return facet;
}

/** Deletes a facet with all its values and product links. */
export async function deleteFacet(ctx: ServiceContext, facetId: string) {
  const res = await db.facet.deleteMany({ where: { id: facetId, tenantId: ctx.tenantId } });
  if (res.count === 0) throw notFound("Facet");
  await log(ctx, "facet.delete", "Facet", facetId);
}

/** Moves a facet to position `index` (0-based) in the facet order; the others are renumbered. */
export async function moveFacet(ctx: ServiceContext, facetId: string, index: number) {
  const data = parseInput(z.object({ index: z.int().min(0).max(10_000) }), { index });
  await db.$transaction(async (tx) => {
    await lockTenantFacets(tx, ctx.tenantId);
    await requireFacet(tx, ctx.tenantId, facetId);
    const others = await tx.facet.findMany({
      where: { tenantId: ctx.tenantId, NOT: { id: facetId } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    const order = others.map((o) => o.id);
    order.splice(Math.min(data.index, order.length), 0, facetId);
    for (const [i, fid] of order.entries()) await tx.facet.update({ where: { id: fid }, data: { sortOrder: i } });
  });
  await log(ctx, "facet.reorder", "Facet", facetId, { index: data.index });
}

// ─── Values ─────────────────────────────────────────────────────────────────

const createValueSchema = z.object({ name: nameSchema, slug: slugInput, parentId: id.nullish(), legacyTagId: z.int().nullish() });
export type CreateFacetValueInput = z.input<typeof createValueSchema>;

/** Creates a value as the last child of `parentId` (or root) of the facet. */
export async function createFacetValue(ctx: ServiceContext, facetId: string, input: CreateFacetValueInput) {
  const data = parseInput(createValueSchema, input);
  const value = await db
    .$transaction(async (tx) => {
      await requireFacet(tx, ctx.tenantId, facetId);
      await lockFacet(tx, facetId);
      const parentId = data.parentId ?? null;
      await assertValidValueParent(tx, ctx.tenantId, facetId, null, parentId);
      return tx.facetValue.create({
        data: {
          tenantId: ctx.tenantId,
          facetId,
          parentId,
          name: data.name,
          slug: await uniqueValueSlug(tx, facetId, data.slug || data.name),
          sortOrder: await nextValueSortOrder(tx, facetId, parentId),
          legacyTagId: data.legacyTagId ?? null,
        },
      });
    })
    .catch(mapValueConflict);
  await log(ctx, "facet.value_create", "FacetValue", value.id, { facetId, name: value.name });
  return value;
}

const updateValueSchema = z.object({
  name: nameSchema.optional(),
  slug: slugInput,
  regenerateSlug: z.boolean().optional(),
  parentId: id.nullish(),
});
export type UpdateFacetValueInput = z.input<typeof updateValueSchema>;

/** Renames / re-slugs a value; `parentId` (when given and different) moves it to the end of the new parent. */
export async function updateFacetValue(ctx: ServiceContext, valueId: string, patch: UpdateFacetValueInput) {
  const data = parseInput(updateValueSchema, patch);
  const value = await db
    .$transaction(async (tx) => {
      const current = await requireValue(tx, ctx.tenantId, valueId);
      await lockFacet(tx, current.facetId);
      const update: Prisma.FacetValueUncheckedUpdateInput = {};
      if (data.name !== undefined) update.name = data.name;
      if (data.slug) {
        const slug = slugify(data.slug);
        if (!slug) throw new ServiceError("INVALID", "Slug is empty");
        update.slug = slug;
      } else if (data.regenerateSlug) {
        update.slug = await uniqueValueSlug(tx, current.facetId, data.name ?? current.name, valueId);
      }
      if (data.parentId !== undefined && (data.parentId ?? null) !== current.parentId) {
        const parentId = data.parentId ?? null;
        await assertValidValueParent(tx, ctx.tenantId, current.facetId, valueId, parentId);
        update.parentId = parentId;
        update.sortOrder = await nextValueSortOrder(tx, current.facetId, parentId);
      }
      return tx.facetValue.update({ where: { id: valueId }, data: update });
    })
    .catch(mapValueConflict);
  await log(ctx, "facet.value_update", "FacetValue", valueId, { fields: Object.keys(data) });
  return value;
}

/**
 * Moves a value under `parentId` (null = root, same facet) at sibling position `index` (default:
 * last). Siblings are renumbered 0..n-1. Cycle → INVALID.
 */
export async function moveFacetValue(ctx: ServiceContext, valueId: string, input: { parentId: string | null; index?: number }) {
  const data = parseInput(z.object({ parentId: id.nullable(), index: z.int().min(0).optional() }), input);
  await db.$transaction(async (tx) => {
    const current = await requireValue(tx, ctx.tenantId, valueId);
    await lockFacet(tx, current.facetId);
    await assertValidValueParent(tx, ctx.tenantId, current.facetId, valueId, data.parentId);
    const siblings = await tx.facetValue.findMany({
      where: { facetId: current.facetId, parentId: data.parentId, NOT: { id: valueId } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    const order = siblings.map((s) => s.id);
    order.splice(Math.min(data.index ?? order.length, order.length), 0, valueId);
    await tx.facetValue.update({ where: { id: valueId }, data: { parentId: data.parentId } });
    await renumberValues(tx, order);
  });
  await log(ctx, "facet.value_move", "FacetValue", valueId, data);
}

/** Sets the order of all children of `parentId` (null = roots) in a facet; must be exactly that sibling set. */
export async function reorderFacetValues(ctx: ServiceContext, facetId: string, parentId: string | null, orderedIds: string[]) {
  const data = parseInput(z.object({ parentId: id.nullable(), orderedIds: z.array(id).max(5000) }), { parentId, orderedIds });
  await db.$transaction(async (tx) => {
    await requireFacet(tx, ctx.tenantId, facetId);
    await lockFacet(tx, facetId);
    const siblings = await tx.facetValue.findMany({ where: { facetId, parentId: data.parentId }, select: { id: true } });
    const set = new Set(siblings.map((s) => s.id));
    if (set.size !== data.orderedIds.length || new Set(data.orderedIds).size !== data.orderedIds.length || !data.orderedIds.every((x) => set.has(x))) {
      throw new ServiceError("INVALID", "orderedIds must list every child of the parent exactly once");
    }
    await renumberValues(tx, data.orderedIds);
  });
  await log(ctx, "facet.value_reorder", "Facet", facetId, { parentId: data.parentId });
}

/** Deletes a value; its product links go with it, its children move up to its parent (appended last). */
export async function deleteFacetValue(ctx: ServiceContext, valueId: string) {
  const moved = await db.$transaction(async (tx) => {
    const current = await requireValue(tx, ctx.tenantId, valueId);
    await lockFacet(tx, current.facetId);
    const children = await tx.facetValue.findMany({ where: { parentId: valueId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true } });
    let next = await nextValueSortOrder(tx, current.facetId, current.parentId);
    for (const ch of children) await tx.facetValue.update({ where: { id: ch.id }, data: { parentId: current.parentId, sortOrder: next++ } });
    await tx.facetValue.delete({ where: { id: valueId } });
    return children.length;
  });
  await log(ctx, "facet.value_delete", "FacetValue", valueId, { movedChildren: moved });
  return { movedChildren: moved };
}

const mergeSchema = z.object({ sourceIds: z.array(id).min(1).max(200), targetId: id });

/**
 * Merges values into `targetId` (same facet): products linked to a source get the target (no
 * duplicates), children of the sources move under the target, then the sources are deleted.
 * The target keeps its name/slug; it inherits a source's legacyTagId when it has none.
 */
export async function mergeFacetValues(ctx: ServiceContext, sourceIds: string[], targetId: string): Promise<{ linked: number; deleted: number }> {
  const data = parseInput(mergeSchema, { sourceIds, targetId });
  const sources = [...new Set(data.sourceIds)].filter((s) => s !== data.targetId);
  if (!sources.length) throw new ServiceError("INVALID", "Nothing to merge");
  const result = await db.$transaction(async (tx) => {
    const target = await requireValue(tx, ctx.tenantId, data.targetId);
    await lockFacet(tx, target.facetId);
    const found = await tx.facetValue.findMany({ where: { tenantId: ctx.tenantId, id: { in: sources } } });
    if (found.length !== sources.length) throw notFound("Facet value");
    if (found.some((v) => v.facetId !== target.facetId)) throw new ServiceError("INVALID", "Only values of the same facet can be merged");
    const parents = await valueParentMap(tx, target.facetId);
    if (sources.some((s) => isSelfOrDescendant(parents, s, target.id))) {
      throw new ServiceError("INVALID", "A value cannot be merged into one of its own children");
    }
    const linked = await tx.$executeRaw`
      INSERT INTO product_facet_values ("tenantId", "productId", "facetValueId")
      SELECT DISTINCT ${ctx.tenantId}, pfv."productId", ${target.id}
      FROM product_facet_values pfv
      WHERE pfv."tenantId" = ${ctx.tenantId} AND pfv."facetValueId" = ANY(${sources}::text[])
      ON CONFLICT DO NOTHING`;
    let next = await nextValueSortOrder(tx, target.facetId, target.id);
    const children = await tx.facetValue.findMany({
      where: { parentId: { in: sources }, NOT: { id: { in: sources } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    for (const ch of children) await tx.facetValue.update({ where: { id: ch.id }, data: { parentId: target.id, sortOrder: next++ } });
    const legacy = found.find((v) => v.legacyTagId !== null)?.legacyTagId ?? null;
    const deleted = await tx.facetValue.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: sources } } });
    if (target.legacyTagId === null && legacy !== null) await tx.facetValue.update({ where: { id: target.id }, data: { legacyTagId: legacy } });
    return { linked, deleted: deleted.count };
  });
  await log(ctx, "facet.value_merge", "FacetValue", data.targetId, { sourceIds: sources, ...result });
  return result;
}

// ─── Product assignments ────────────────────────────────────────────────────

async function requireProductIds(tx: Tx, tenantId: string, productIds: string[]) {
  const rows = await tx.product.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true } });
  if (rows.length !== productIds.length) throw notFound("Product");
}

async function requireValueIds(tx: Tx, tenantId: string, valueIds: string[]) {
  const rows = await tx.facetValue.findMany({ where: { tenantId, id: { in: valueIds } }, select: { id: true } });
  if (rows.length !== valueIds.length) throw notFound("Facet value");
}

/** Links every product to every value (bulk; existing links are kept). Returns links added. */
export async function assignFacetValues(ctx: ServiceContext, productIds: string[], valueIds: string[]): Promise<{ linked: number }> {
  const data = parseInput(z.object({ productIds: ids, valueIds: z.array(id).min(1).max(100) }), { productIds, valueIds });
  const products = [...new Set(data.productIds)];
  const values = [...new Set(data.valueIds)];
  const linked = await db.$transaction(async (tx) => {
    await requireProductIds(tx, ctx.tenantId, products);
    await requireValueIds(tx, ctx.tenantId, values);
    const res = await tx.productFacetValue.createMany({
      data: products.flatMap((productId) => values.map((facetValueId) => ({ tenantId: ctx.tenantId, productId, facetValueId }))),
      skipDuplicates: true,
    });
    return res.count;
  });
  await log(ctx, "facet.assign", "Product", products.length === 1 ? products[0] : "bulk", { productCount: products.length, valueIds: values, linked });
  return { linked };
}

/** Removes the links between the products and the values (bulk). Returns links removed. */
export async function unassignFacetValues(ctx: ServiceContext, productIds: string[], valueIds: string[]): Promise<{ unlinked: number }> {
  const data = parseInput(z.object({ productIds: ids, valueIds: z.array(id).min(1).max(100) }), { productIds, valueIds });
  const res = await db.productFacetValue.deleteMany({
    where: { tenantId: ctx.tenantId, productId: { in: data.productIds }, facetValueId: { in: data.valueIds } },
  });
  await log(ctx, "facet.unassign", "Product", data.productIds.length === 1 ? data.productIds[0] : "bulk", {
    productCount: data.productIds.length,
    valueIds: data.valueIds,
    unlinked: res.count,
  });
  return { unlinked: res.count };
}

/** Value ids linked to a product. */
export async function getProductFacetValueIds(ctx: ServiceContext, productId: string): Promise<string[]> {
  const product = await db.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!product) throw notFound("Product");
  const rows = await db.productFacetValue.findMany({ where: { tenantId: ctx.tenantId, productId }, select: { facetValueId: true } });
  return rows.map((r) => r.facetValueId);
}

/**
 * Replaces a product's values. With `facetId`, only that facet's values are replaced (the other
 * facets are left alone) and every value must belong to it.
 */
export async function setProductFacetValues(ctx: ServiceContext, productId: string, valueIds: string[], opts: { facetId?: string } = {}) {
  const data = parseInput(z.object({ productId: id, valueIds: z.array(id).max(200), facetId: id.optional() }), { productId, valueIds, ...opts });
  const values = [...new Set(data.valueIds)];
  await db.$transaction(async (tx) => {
    await requireProductIds(tx, ctx.tenantId, [data.productId]);
    if (values.length) {
      const rows = await tx.facetValue.findMany({ where: { tenantId: ctx.tenantId, id: { in: values } }, select: { id: true, facetId: true } });
      if (rows.length !== values.length) throw notFound("Facet value");
      if (data.facetId && rows.some((r) => r.facetId !== data.facetId)) throw new ServiceError("INVALID", "A value belongs to another facet");
    }
    if (data.facetId) await requireFacet(tx, ctx.tenantId, data.facetId);
    await tx.productFacetValue.deleteMany({
      where: { tenantId: ctx.tenantId, productId: data.productId, ...(data.facetId ? { facetValue: { facetId: data.facetId } } : {}) },
    });
    if (values.length) {
      await tx.productFacetValue.createMany({
        data: values.map((facetValueId) => ({ tenantId: ctx.tenantId, productId: data.productId, facetValueId })),
        skipDuplicates: true,
      });
    }
  });
  await log(ctx, "facet.product_set", "Product", data.productId, { facetId: data.facetId ?? null, valueIds: values });
}

// ─── Tags → facet ───────────────────────────────────────────────────────────

const convertSchema = z.object({
  tagIds: z.array(id).min(1).max(500),
  facetId: id,
  parentId: id.nullish(),
  deleteTags: z.boolean().optional(),
});

export type ConvertTagsResult = {
  /** Values newly created for a tag. */
  created: number;
  /** Tags that matched an existing value (same name, case-insensitive) of the facet. */
  reused: number;
  /** Product links added. */
  linked: number;
  /** Tags deleted (only with deleteTags). */
  deletedTags: number;
  /** tagId → facet value id. */
  mapping: Record<string, string>;
};

/**
 * Converts tags into values of a facet: for every tag a value with the same name is reused
 * (case-insensitive, anywhere in the facet; one under `parentId` preferred) or created under
 * `parentId`; the value gets `legacyTagId = tag.legacyId` when it has none; every product of the tag
 * is linked to the value; with `deleteTags` the tags are deleted afterwards (their ProductTag links
 * go with them). One transaction — all or nothing.
 */
export async function convertTagsToFacet(
  ctx: ServiceContext,
  tagIds: string[],
  facetId: string,
  opts: { parentId?: string | null; deleteTags?: boolean } = {},
): Promise<ConvertTagsResult> {
  const data = parseInput(convertSchema, { tagIds, facetId, ...opts });
  const unique = [...new Set(data.tagIds)];
  const result = await db
    .$transaction(
      async (tx) => {
        await requireFacet(tx, ctx.tenantId, data.facetId);
        await lockFacet(tx, data.facetId);
        const parentId = data.parentId ?? null;
        await assertValidValueParent(tx, ctx.tenantId, data.facetId, null, parentId);
        const tags = await tx.tag.findMany({ where: { tenantId: ctx.tenantId, id: { in: unique } }, orderBy: { name: "asc" } });
        if (tags.length !== unique.length) throw notFound("Tag");
        const existing = await tx.facetValue.findMany({ where: { facetId: data.facetId } });
        let created = 0;
        let reused = 0;
        let linked = 0;
        const mapping: Record<string, string> = {};
        for (const tag of tags) {
          const key = tag.name.trim().toLowerCase();
          const matches = existing.filter((v) => v.name.trim().toLowerCase() === key);
          let value = matches.find((v) => v.parentId === parentId) ?? matches[0];
          if (value) {
            reused++;
            if (value.legacyTagId === null && tag.legacyId !== null) {
              value = await tx.facetValue.update({ where: { id: value.id }, data: { legacyTagId: tag.legacyId } });
            }
          } else {
            value = await tx.facetValue.create({
              data: {
                tenantId: ctx.tenantId,
                facetId: data.facetId,
                parentId,
                name: tag.name.trim(),
                slug: await uniqueValueSlug(tx, data.facetId, tag.slug || tag.name),
                sortOrder: await nextValueSortOrder(tx, data.facetId, parentId),
                legacyTagId: tag.legacyId,
              },
            });
            existing.push(value);
            created++;
          }
          mapping[tag.id] = value.id;
          linked += await tx.$executeRaw`
            INSERT INTO product_facet_values ("tenantId", "productId", "facetValueId")
            SELECT ${ctx.tenantId}, pt."productId", ${value.id}
            FROM product_tags pt
            WHERE pt."tenantId" = ${ctx.tenantId} AND pt."tagId" = ${tag.id}
            ON CONFLICT DO NOTHING`;
        }
        const deletedTags = data.deleteTags ? (await tx.tag.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: unique } } })).count : 0;
        return { created, reused, linked, deletedTags, mapping };
      },
      { timeout: 30_000 },
    )
    .catch(mapValueConflict);
  await log(ctx, "facet.convert_tags", "Facet", data.facetId, {
    tagIds: unique,
    created: result.created,
    reused: result.reused,
    linked: result.linked,
    deletedTags: result.deletedTags,
  });
  return result;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

/**
 * Creates the standard facets (Period, Country, Branch, Unit, Type, Maker) with starter values for
 * a tenant. Idempotent: facets are matched by slug, values by name within the facet (case-insensitive,
 * anywhere in the tree); existing ones are left untouched. System operation (no actor).
 */
export async function seedDefaultFacets(tenantId: string, actorId: string | null = null): Promise<{ facetsCreated: number; valuesCreated: number }> {
  const result = await db.$transaction(
    async (tx) => {
      await lockTenantFacets(tx, tenantId);
      let facetsCreated = 0;
      let valuesCreated = 0;
      let order = ((await tx.facet.aggregate({ where: { tenantId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
      for (const def of DEFAULT_FACETS) {
        let facet = await tx.facet.findFirst({ where: { tenantId, slug: def.slug } });
        if (!facet) {
          facet = await tx.facet.create({ data: { tenantId, kind: def.kind, name: def.name, slug: def.slug, sortOrder: order++ } });
          facetsCreated++;
        }
        const facetId = facet.id;
        await lockFacet(tx, facetId);
        const existing = await tx.facetValue.findMany({ where: { facetId }, select: { id: true, name: true } });
        const byName = new Map(existing.map((v) => [v.name.trim().toLowerCase(), v.id]));
        const ensure = async (values: readonly DefaultValue[], parentId: string | null) => {
          for (const v of values) {
            let vid = byName.get(v.name.toLowerCase());
            if (!vid) {
              const row = await tx.facetValue.create({
                data: {
                  tenantId,
                  facetId,
                  parentId,
                  name: v.name,
                  slug: await uniqueValueSlug(tx, facetId, v.name),
                  sortOrder: await nextValueSortOrder(tx, facetId, parentId),
                },
              });
              vid = row.id;
              byName.set(v.name.toLowerCase(), vid);
              valuesCreated++;
            }
            if (v.children?.length) await ensure(v.children, vid);
          }
        };
        await ensure(def.values, null);
      }
      return { facetsCreated, valuesCreated };
    },
    { timeout: 30_000 },
  );
  if (result.facetsCreated || result.valuesCreated) {
    await audit({ action: "facet.seed_defaults", tenantId, actorId, entity: "Facet", entityId: tenantId, data: result });
  }
  return result;
}
