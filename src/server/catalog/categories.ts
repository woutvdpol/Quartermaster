import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { isUniqueViolation, notFound, parseInput } from "./errors";
import { nextFreeSlug, slugify } from "./slug";

/*
 * Category tree. Tree mutations (create/move/reorder/delete) take a per-tenant advisory lock so two
 * concurrent moves can never build a cycle together. The tree is small (tens to hundreds of nodes),
 * so cycle checks and counts load the whole tenant tree.
 */

type Tx = Prisma.TransactionClient;

export type CategoryNode = {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  /** Products directly in this category (any status). */
  productCount: number;
  /** Products in this category and all descendants. */
  totalProductCount: number;
  children: CategoryNode[];
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const baseFields = {
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(120).optional(),
  description: optionalText(20000),
  isActive: z.boolean().optional(),
  seoTitle: optionalText(200),
  seoDescription: optionalText(500),
};

const createSchema = z.object({ ...baseFields, parentId: z.string().min(1).nullish() });
const updateSchema = z
  .object({
    title: baseFields.title.optional(),
    slug: baseFields.slug,
    regenerateSlug: z.boolean().optional(),
    description: baseFields.description.optional(),
    isActive: z.boolean().optional(),
    seoTitle: baseFields.seoTitle.optional(),
    seoDescription: baseFields.seoDescription.optional(),
    parentId: z.string().min(1).nullish(),
  })
  .partial();

export type CreateCategoryInput = z.input<typeof createSchema>;
export type UpdateCategoryInput = z.input<typeof updateSchema>;

async function lockTree(tx: Tx, tenantId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"category-tree:" + tenantId}))`;
}

async function uniqueCategorySlug(tx: Tx, tenantId: string, wanted: string, excludeId?: string) {
  const base = slugify(wanted) || "category";
  const rows = await tx.category.findMany({
    where: { tenantId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { slug: true },
  });
  return nextFreeSlug(
    base,
    rows.map((r) => r.slug),
  );
}

/** Parent map of the tenant's tree (id → parentId). */
async function parentMap(tx: Tx, tenantId: string) {
  const rows = await tx.category.findMany({ where: { tenantId }, select: { id: true, parentId: true } });
  return new Map(rows.map((r) => [r.id, r.parentId]));
}

/** True when `candidate` is `id` itself or one of its descendants. */
function isSelfOrDescendant(parents: Map<string, string | null>, id: string, candidate: string): boolean {
  let cur: string | null | undefined = candidate;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return true; // corrupt data: treat as cycle
    seen.add(cur);
    cur = parents.get(cur);
  }
  return false;
}

async function requireCategory(tx: Tx, tenantId: string, id: string) {
  const cat = await tx.category.findFirst({ where: { id, tenantId } });
  if (!cat) throw notFound("Category");
  return cat;
}

async function nextSortOrder(tx: Tx, tenantId: string, parentId: string | null) {
  const agg = await tx.category.aggregate({ where: { tenantId, parentId }, _max: { sortOrder: true } });
  return (agg._max.sortOrder ?? -1) + 1;
}

/** Whole tree with product counts, siblings ordered by sortOrder, then title. */
export async function listCategoryTree(ctx: ServiceContext): Promise<CategoryNode[]> {
  const [cats, counts] = await Promise.all([
    db.category.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: { id: true, parentId: true, title: true, slug: true, isActive: true, sortOrder: true },
    }),
    db.product.groupBy({ by: ["categoryId"], where: { tenantId: ctx.tenantId, categoryId: { not: null } }, _count: { _all: true } }),
  ]);
  const countBy = new Map(counts.map((c) => [c.categoryId!, c._count._all]));
  const nodes = new Map<string, CategoryNode>(
    cats.map((c) => [c.id, { ...c, productCount: countBy.get(c.id) ?? 0, totalProductCount: 0, children: [] }]),
  );
  const roots: CategoryNode[] = [];
  for (const c of cats) {
    const node = nodes.get(c.id)!;
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const total = (n: CategoryNode, guard: Set<string>): number => {
    if (guard.has(n.id)) return 0;
    guard.add(n.id);
    n.totalProductCount = n.productCount + n.children.reduce((s, ch) => s + total(ch, guard), 0);
    return n.totalProductCount;
  };
  const guard = new Set<string>();
  roots.forEach((r) => total(r, guard));
  return roots;
}

export async function getCategory(ctx: ServiceContext, id: string) {
  const cat = await db.category.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!cat) throw notFound("Category");
  return cat;
}

/** Creates a category as the last child of `parentId` (or root). Slug from `slug` or title, de-duplicated. */
export async function createCategory(ctx: ServiceContext, input: CreateCategoryInput) {
  const data = parseInput(createSchema, input);
  const cat = await db
    .$transaction(async (tx) => {
      await lockTree(tx, ctx.tenantId);
      const parentId = data.parentId ?? null;
      if (parentId) await requireCategory(tx, ctx.tenantId, parentId);
      return tx.category.create({
        data: {
          tenantId: ctx.tenantId,
          parentId,
          title: data.title,
          slug: await uniqueCategorySlug(tx, ctx.tenantId, data.slug || data.title),
          description: data.description,
          isActive: data.isActive ?? true,
          seoTitle: data.seoTitle,
          seoDescription: data.seoDescription,
          sortOrder: await nextSortOrder(tx, ctx.tenantId, parentId),
        },
      });
    })
    .catch(mapSlugConflict);
  await audit({ action: "category.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Category", entityId: cat.id, data: { title: cat.title } });
  return cat;
}

function mapSlugConflict(err: unknown): never {
  if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "A category with this slug already exists");
  throw err;
}

/**
 * Updates fields. Slug changes only when `slug` is given (explicit, must be free → CONFLICT) or
 * `regenerateSlug` is true (from the new title, de-duplicated). `parentId` here is a move (appended
 * last under the new parent); moving under itself or a descendant → INVALID.
 */
export async function updateCategory(ctx: ServiceContext, id: string, patch: UpdateCategoryInput) {
  const data = parseInput(updateSchema, patch);
  const cat = await db
    .$transaction(async (tx) => {
      await lockTree(tx, ctx.tenantId);
      const current = await requireCategory(tx, ctx.tenantId, id);
      const update: Prisma.CategoryUncheckedUpdateInput = {};
      if (data.title !== undefined) update.title = data.title;
      if (data.description !== undefined) update.description = data.description;
      if (data.isActive !== undefined) update.isActive = data.isActive;
      if (data.seoTitle !== undefined) update.seoTitle = data.seoTitle;
      if (data.seoDescription !== undefined) update.seoDescription = data.seoDescription;
      if (data.slug) {
        const slug = slugify(data.slug);
        if (!slug) throw new ServiceError("INVALID", "Slug is empty");
        update.slug = slug; // unique violation → CONFLICT
      } else if (data.regenerateSlug) {
        update.slug = await uniqueCategorySlug(tx, ctx.tenantId, data.title ?? current.title, id);
      }
      if (data.parentId !== undefined && (data.parentId ?? null) !== current.parentId) {
        const parentId = data.parentId ?? null;
        await assertValidParent(tx, ctx.tenantId, id, parentId);
        update.parentId = parentId;
        update.sortOrder = await nextSortOrder(tx, ctx.tenantId, parentId);
      }
      return tx.category.update({ where: { id }, data: update });
    })
    .catch(mapSlugConflict);
  await audit({ action: "category.update", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Category", entityId: id, data: { fields: Object.keys(data) } });
  return cat;
}

async function assertValidParent(tx: Tx, tenantId: string, id: string, parentId: string | null) {
  if (!parentId) return;
  await requireCategory(tx, tenantId, parentId);
  if (isSelfOrDescendant(await parentMap(tx, tenantId), id, parentId)) {
    throw new ServiceError("INVALID", "A category cannot be moved under itself or one of its subcategories");
  }
}

const moveSchema = z.object({ parentId: z.string().min(1).nullable(), index: z.int().min(0).optional() });

/**
 * Moves a category under `parentId` (null = root) at sibling position `index` (default: last).
 * Sibling sortOrders are renumbered 0..n-1. Cycle → INVALID.
 */
export async function moveCategory(ctx: ServiceContext, id: string, input: { parentId: string | null; index?: number }) {
  const data = parseInput(moveSchema, input);
  await db.$transaction(async (tx) => {
    await lockTree(tx, ctx.tenantId);
    await requireCategory(tx, ctx.tenantId, id);
    await assertValidParent(tx, ctx.tenantId, id, data.parentId);
    const siblings = await tx.category.findMany({
      where: { tenantId: ctx.tenantId, parentId: data.parentId, NOT: { id } },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: { id: true },
    });
    const ids = siblings.map((s) => s.id);
    ids.splice(Math.min(data.index ?? ids.length, ids.length), 0, id);
    await tx.category.update({ where: { id }, data: { parentId: data.parentId } });
    await renumber(tx, ids);
  });
  await audit({ action: "category.move", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Category", entityId: id, data: data });
}

async function renumber(tx: Tx, orderedIds: string[]) {
  for (const [i, cid] of orderedIds.entries()) {
    await tx.category.update({ where: { id: cid }, data: { sortOrder: i } });
  }
}

const reorderSchema = z.object({ parentId: z.string().min(1).nullable(), orderedIds: z.array(z.string().min(1)).max(1000) });

/** Sets the order of all children of `parentId`; `orderedIds` must be exactly that sibling set. */
export async function reorderCategories(ctx: ServiceContext, parentId: string | null, orderedIds: string[]) {
  const data = parseInput(reorderSchema, { parentId, orderedIds });
  await db.$transaction(async (tx) => {
    await lockTree(tx, ctx.tenantId);
    const siblings = await tx.category.findMany({ where: { tenantId: ctx.tenantId, parentId: data.parentId }, select: { id: true } });
    const set = new Set(siblings.map((s) => s.id));
    if (set.size !== data.orderedIds.length || new Set(data.orderedIds).size !== data.orderedIds.length || !data.orderedIds.every((x) => set.has(x))) {
      throw new ServiceError("INVALID", "orderedIds must list every child of the parent exactly once");
    }
    await renumber(tx, data.orderedIds);
  });
  await audit({ action: "category.reorder", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Category", entityId: data.parentId ?? "root" });
}

const deleteSchema = z.object({ reassignTo: z.string().min(1).nullish() }).optional();

/**
 * Deletes a category.
 * - Without `reassignTo`: only when it has no products and no subcategories, else CONFLICT
 *   (details: { productCount, childCount }).
 * - With `reassignTo` (another category): its products and direct subcategories move there first.
 *   The target must not be the category itself or a descendant (INVALID).
 */
export async function deleteCategory(ctx: ServiceContext, id: string, opts?: { reassignTo?: string | null }) {
  const data = parseInput(deleteSchema, opts) ?? {};
  const moved = await db.$transaction(async (tx) => {
    await lockTree(tx, ctx.tenantId);
    await requireCategory(tx, ctx.tenantId, id);
    const [productCount, childCount] = await Promise.all([
      tx.product.count({ where: { tenantId: ctx.tenantId, categoryId: id } }),
      tx.category.count({ where: { tenantId: ctx.tenantId, parentId: id } }),
    ]);
    let movedProducts = 0;
    if (productCount || childCount) {
      if (!data.reassignTo) {
        throw new ServiceError("CONFLICT", "Category is not empty; choose a category to move its contents to", { productCount, childCount });
      }
      await requireCategory(tx, ctx.tenantId, data.reassignTo);
      if (isSelfOrDescendant(await parentMap(tx, ctx.tenantId), id, data.reassignTo)) {
        throw new ServiceError("INVALID", "Cannot move contents into the category itself or one of its subcategories");
      }
      movedProducts = (await tx.product.updateMany({ where: { tenantId: ctx.tenantId, categoryId: id }, data: { categoryId: data.reassignTo } })).count;
      const children = await tx.category.findMany({ where: { tenantId: ctx.tenantId, parentId: id }, orderBy: { sortOrder: "asc" }, select: { id: true } });
      let next = await nextSortOrder(tx, ctx.tenantId, data.reassignTo);
      for (const ch of children) await tx.category.update({ where: { id: ch.id }, data: { parentId: data.reassignTo, sortOrder: next++ } });
    }
    await tx.category.delete({ where: { id } });
    return { movedProducts, movedChildren: childCount };
  });
  await audit({ action: "category.delete", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Category", entityId: id, data: { reassignTo: data.reassignTo ?? null, ...moved } });
  return moved;
}
