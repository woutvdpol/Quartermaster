import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { isUniqueViolation, notFound, parseInput } from "./errors";
import { nextFreeSlug, slugify } from "./slug";

type Tx = Prisma.TransactionClient;

export type TagRow = { id: string; name: string; slug: string; description: string | null; productCount: number };

const nameSchema = z.string().trim().min(1).max(100);
const descriptionSchema = z
  .string()
  .trim()
  .max(20000)
  .nullish()
  .transform((v) => (v ? v : null));
const createSchema = z.object({ name: nameSchema, description: descriptionSchema });
const updateSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  regenerateSlug: z.boolean().optional(),
});

async function uniqueTagSlug(tx: Tx, tenantId: string, name: string, excludeId?: string) {
  const base = slugify(name) || "tag";
  const rows = await tx.tag.findMany({
    where: { tenantId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { slug: true },
  });
  return nextFreeSlug(
    base,
    rows.map((r) => r.slug),
  );
}

function mapNameConflict(err: unknown): never {
  if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "A tag with this name already exists");
  throw err;
}

/** All tags (optionally filtered by name substring), alphabetical, with product counts. */
export async function listTags(ctx: ServiceContext, query: { search?: string } = {}): Promise<TagRow[]> {
  const search = query.search?.trim();
  const tags = await db.tag.findMany({
    where: { tenantId: ctx.tenantId, ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, description: true, _count: { select: { products: true } } },
  });
  return tags.map(({ _count, ...t }) => ({ ...t, productCount: _count.products }));
}

/** Creates a tag; names are unique per tenant (case-sensitive in the DB; we also reject case-insensitive duplicates). */
export async function createTag(ctx: ServiceContext, input: { name: string; description?: string | null }) {
  const data = parseInput(createSchema, input);
  const tag = await db
    .$transaction(async (tx) => {
      const dupe = await tx.tag.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: data.name, mode: "insensitive" } }, select: { id: true } });
      if (dupe) throw new ServiceError("CONFLICT", "A tag with this name already exists", { id: dupe.id });
      return tx.tag.create({
        data: { tenantId: ctx.tenantId, name: data.name, description: data.description, slug: await uniqueTagSlug(tx, ctx.tenantId, data.name) },
      });
    })
    .catch(mapNameConflict);
  await audit({ action: "tag.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tag", entityId: tag.id, data: { name: tag.name } });
  return tag;
}

/** Renames / edits a tag. The slug only changes with `regenerateSlug: true`. */
export async function updateTag(ctx: ServiceContext, id: string, patch: { name?: string; description?: string | null; regenerateSlug?: boolean }) {
  const data = parseInput(updateSchema, patch);
  const tag = await db
    .$transaction(async (tx) => {
      const current = await tx.tag.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!current) throw notFound("Tag");
      if (data.name && data.name.toLowerCase() !== current.name.toLowerCase()) {
        const dupe = await tx.tag.findFirst({
          where: { tenantId: ctx.tenantId, name: { equals: data.name, mode: "insensitive" }, NOT: { id } },
          select: { id: true },
        });
        if (dupe) throw new ServiceError("CONFLICT", "A tag with this name already exists", { id: dupe.id });
      }
      return tx.tag.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.regenerateSlug ? { slug: await uniqueTagSlug(tx, ctx.tenantId, data.name ?? current.name, id) } : {}),
        },
      });
    })
    .catch(mapNameConflict);
  await audit({ action: "tag.update", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tag", entityId: id, data: { fields: Object.keys(data) } });
  return tag;
}

/** Deletes a tag; its product links go with it (ProductTag cascade). */
export async function deleteTag(ctx: ServiceContext, id: string) {
  const res = await db.tag.deleteMany({ where: { id, tenantId: ctx.tenantId } });
  if (res.count === 0) throw notFound("Tag");
  await audit({ action: "tag.delete", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tag", entityId: id });
}

const mergeSchema = z.object({ sourceIds: z.array(z.string().min(1)).min(1).max(100), targetId: z.string().min(1) });

/**
 * Merges `sourceIds` into `targetId`: every product tagged with a source gets the target tag
 * (no duplicates), then the source tags are deleted. Returns how many product links were added.
 */
export async function mergeTags(ctx: ServiceContext, sourceIds: string[], targetId: string): Promise<{ linked: number; deleted: number }> {
  const data = parseInput(mergeSchema, { sourceIds, targetId });
  const sources = [...new Set(data.sourceIds)].filter((s) => s !== data.targetId);
  if (sources.length === 0) throw new ServiceError("INVALID", "Nothing to merge");
  const result = await db.$transaction(async (tx) => {
    const found = await tx.tag.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...sources, data.targetId] } }, select: { id: true } });
    if (found.length !== sources.length + 1) throw notFound("Tag");
    const linked = await tx.$executeRaw`
      INSERT INTO product_tags ("tenantId", "productId", "tagId")
      SELECT DISTINCT ${ctx.tenantId}, pt."productId", ${data.targetId}
      FROM product_tags pt
      WHERE pt."tenantId" = ${ctx.tenantId} AND pt."tagId" = ANY(${sources}::text[])
      ON CONFLICT DO NOTHING`;
    const deleted = await tx.tag.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: sources } } });
    return { linked, deleted: deleted.count };
  });
  await audit({ action: "tag.merge", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tag", entityId: data.targetId, data: { sourceIds: sources, ...result } });
  return result;
}
