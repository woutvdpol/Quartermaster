import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import { isUniqueViolation, notFound, parseInput } from "@/server/catalog/errors";
import { nextFreeSlug, slugify } from "@/server/catalog/slug";
import type { Prisma } from "@/generated/prisma/client";
import type { ContentBlockType } from "@/generated/prisma/enums";
import {
  blockReferences,
  blockTypeSchema,
  catalogEntry,
  defaultBlockData,
  parseBlock,
  type BlockIssue,
  type ParsedBlock,
} from "./blocks";
import { MAX_PAGE_SLUG_LENGTH, RESERVED_SLUGS, SYSTEM_PAGE_KEYS, SYSTEM_PAGES, type SystemPageKey } from "./rules";
import { SYSTEM_PAGE_STARTER_BLOCKS } from "./starter";

/*
 * Block CMS pages. One page = ordered ContentBlocks (sortOrder 0..n-1, renumbered on every change).
 * Every block mutation locks the page row (SELECT … FOR UPDATE) so concurrent editors cannot produce
 * duplicate positions. System pages (systemKey HOME/TERMS/…) cannot be deleted.
 *
 * HERO rule (legacy): at most one HERO per page and it is always block 0.
 */

type Tx = Prisma.TransactionClient;

// ─── Types ───────────────────────────────────────────────────────────────────

export type PageSummary = {
  id: string;
  title: string;
  slug: string;
  systemKey: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  blockCount: number;
};

/** Admin view of a block: `data` is the parsed data when valid, else the raw stored JSON. */
export type AdminBlock = {
  id: string;
  type: ContentBlockType;
  sortOrder: number;
  isVisible: boolean;
  data: unknown;
  valid: boolean;
  issues: BlockIssue[];
};

export type PublicBlock = ParsedBlock & { id: string };

export type PublicPage = {
  id: string;
  title: string;
  slug: string;
  systemKey: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: Date;
  blocks: PublicBlock[];
};

// ─── Input schemas ───────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const titleSchema = z.string().trim().min(1).max(200);
const slugInput = z.string().trim().max(200);

const createPageSchema = z.object({
  title: titleSchema,
  slug: slugInput.optional(),
  seoTitle: optionalText(200),
  seoDescription: optionalText(500),
  published: z.boolean().optional(),
});

const updatePageSchema = z.object({
  title: titleSchema.optional(),
  slug: slugInput.optional(),
  seoTitle: optionalText(200).optional(),
  seoDescription: optionalText(500).optional(),
  published: z.boolean().optional(),
  systemKey: z.enum(SYSTEM_PAGE_KEYS).nullable().optional(),
});

export type CreatePageInput = z.input<typeof createPageSchema>;
export type UpdatePageInput = z.input<typeof updatePageSchema>;

const idSchema = z.string().min(1).max(64);

const addBlockSchema = z.object({
  type: blockTypeSchema,
  /** undefined → append at the end; null → insert at the top (after a HERO); id → right after that block. */
  afterId: idSchema.nullable().optional(),
  /** Initial data; defaults to the type's starter data. */
  data: z.unknown().optional(),
  isVisible: z.boolean().optional(),
});
export type AddBlockInput = z.input<typeof addBlockSchema>;

const updateBlockSchema = z.object({ data: z.unknown().optional(), isVisible: z.boolean().optional() });
export type UpdateBlockInput = z.input<typeof updateBlockSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalises a user-typed slug; empty or reserved → INVALID. */
export function normalizePageSlug(input: string): string {
  const slug = slugify(input, MAX_PAGE_SLUG_LENGTH);
  if (!slug) throw new ServiceError("INVALID", "Slug is empty");
  if (RESERVED_SLUGS.has(slug)) throw new ServiceError("INVALID", `"${slug}" is reserved; choose another slug`);
  return slug;
}

async function freePageSlug(tx: Tx, tenantId: string, wanted: string, excludeId?: string) {
  let base = slugify(wanted, MAX_PAGE_SLUG_LENGTH) || "page";
  if (RESERVED_SLUGS.has(base)) base = `${base}-page`;
  const rows = await tx.contentPage.findMany({
    where: { tenantId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { slug: true },
  });
  return nextFreeSlug(
    base,
    rows.map((r) => r.slug),
  );
}

function mapSlugConflict(err: unknown): never {
  if (isUniqueViolation(err, "slug")) throw new ServiceError("CONFLICT", "A page with this slug already exists");
  if (isUniqueViolation(err, "systemKey")) throw new ServiceError("CONFLICT", "Another page already has this role");
  if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "A page with this slug already exists");
  throw err;
}

/** Locks the page row for the rest of the transaction; NOT_FOUND when it is not the tenant's. */
async function lockPage(tx: Tx, tenantId: string, pageId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM content_pages WHERE id = ${pageId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (!rows.length) throw notFound("Page");
}

async function touchPage(tx: Tx, pageId: string) {
  await tx.contentPage.update({ where: { id: pageId }, data: { updatedAt: new Date() } });
}

async function orderedBlocks(tx: Tx, pageId: string) {
  return tx.contentBlock.findMany({
    where: { pageId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, type: true, sortOrder: true },
  });
}

/** Writes sortOrder 0..n-1 for `orderedIds`, skipping rows that are already right. */
async function renumber(tx: Tx, current: { id: string; sortOrder: number }[], orderedIds: string[]) {
  const was = new Map(current.map((b) => [b.id, b.sortOrder]));
  for (const [i, id] of orderedIds.entries()) {
    if (was.get(id) !== i) await tx.contentBlock.update({ where: { id }, data: { sortOrder: i } });
  }
}

function toAdminBlock(b: { id: string; type: ContentBlockType; sortOrder: number; isVisible: boolean; data: unknown }): AdminBlock {
  const parsed = parseBlock(b.type, b.data);
  return parsed.ok
    ? { id: b.id, type: b.type, sortOrder: b.sortOrder, isVisible: b.isVisible, data: parsed.block.data, valid: true, issues: [] }
    : { id: b.id, type: b.type, sortOrder: b.sortOrder, isVisible: b.isVisible, data: b.data, valid: false, issues: parsed.issues };
}

/** Validates block data for `type` and checks every referenced image/product/category is the tenant's. */
async function validateBlockData(tenantId: string, type: ContentBlockType, data: unknown): Promise<ParsedBlock> {
  const parsed = parseBlock(type, data);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    throw new ServiceError("INVALID", first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "Invalid block", parsed.issues);
  }
  const refs = blockReferences(parsed.block);
  if (refs.imageKeys.some((k) => !k.startsWith(`${tenantId}/`))) throw new ServiceError("INVALID", "Image does not belong to this shop");
  if (refs.productIds.length) {
    const n = await db.product.count({ where: { tenantId, id: { in: refs.productIds } } });
    if (n !== refs.productIds.length) throw new ServiceError("INVALID", "Product not found");
  }
  if (refs.categoryIds.length) {
    const n = await db.category.count({ where: { tenantId, id: { in: refs.categoryIds } } });
    if (n !== refs.categoryIds.length) throw new ServiceError("INVALID", "Category not found");
  }
  return parsed.block;
}

async function assertFeature(tenantId: string, type: ContentBlockType) {
  if (catalogEntry(type).requiresFeature === "newsletter") {
    const platform = await getSettings(tenantId, "platform");
    if (!platform.newsletterEnabled) throw new ServiceError("FORBIDDEN", "The newsletter is not enabled for this shop");
  }
}

const auditCtx = (ctx: ServiceContext) => ({ tenantId: ctx.tenantId, actorId: ctx.actor.id });

// ─── Pages: admin ────────────────────────────────────────────────────────────

/** All pages of the tenant: system pages first (fixed order), then by title. */
export async function listPages(ctx: ServiceContext): Promise<PageSummary[]> {
  const rows = await db.contentPage.findMany({
    where: { tenantId: ctx.tenantId },
    select: { id: true, title: true, slug: true, systemKey: true, publishedAt: true, updatedAt: true, _count: { select: { blocks: true } } },
    orderBy: { title: "asc" },
  });
  const rank = (k: string | null) => (k ? (SYSTEM_PAGE_KEYS as readonly string[]).indexOf(k) : -1);
  return rows
    .map(({ _count, ...r }) => ({ ...r, blockCount: _count.blocks }))
    .sort((a, b) => {
      const ra = rank(a.systemKey);
      const rb = rank(b.systemKey);
      if (a.systemKey && b.systemKey) return ra - rb;
      if (a.systemKey || b.systemKey) return a.systemKey ? -1 : 1;
      return 0;
    });
}

export async function getPage(ctx: ServiceContext, id: string) {
  const page = await db.contentPage.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: { blocks: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!page) throw notFound("Page");
  const { blocks, ...rest } = page;
  return { ...rest, blocks: blocks.map(toAdminBlock) };
}

/**
 * Creates an empty, regular page. Explicit `slug` must be free (CONFLICT) and not reserved (INVALID);
 * without one the slug is derived from the title and de-duplicated.
 */
export async function createPage(ctx: ServiceContext, input: CreatePageInput) {
  const data = parseInput(createPageSchema, input);
  const explicit = data.slug ? normalizePageSlug(data.slug) : null;
  const page = await db
    .$transaction(async (tx) =>
      tx.contentPage.create({
        data: {
          tenantId: ctx.tenantId,
          title: data.title,
          slug: explicit ?? (await freePageSlug(tx, ctx.tenantId, data.title)),
          seoTitle: data.seoTitle,
          seoDescription: data.seoDescription,
          publishedAt: data.published ? new Date() : null,
        },
      }),
    )
    .catch(mapSlugConflict);
  await audit({ action: "content.page.create", ...auditCtx(ctx), entity: "ContentPage", entityId: page.id, data: { slug: page.slug } });
  return page;
}

/**
 * Updates page fields. `published` true keeps an existing publishedAt (else now), false → draft.
 * `systemKey`: assigns a system role (TERMS, …) to this page, taking it from the page that held it
 * (that page becomes a regular page). A page holds at most one role, and a role cannot be removed
 * (null on a system page → INVALID): move it to another page instead. The home page's slug is fixed.
 */
export async function updatePage(ctx: ServiceContext, id: string, patch: UpdatePageInput) {
  const data = parseInput(updatePageSchema, patch);
  const page = await db
    .$transaction(async (tx) => {
      await lockPage(tx, ctx.tenantId, id);
      const current = await tx.contentPage.findUniqueOrThrow({ where: { id } });
      const update: Prisma.ContentPageUncheckedUpdateInput = {};
      if (data.title !== undefined) update.title = data.title;
      if (data.seoTitle !== undefined) update.seoTitle = data.seoTitle;
      if (data.seoDescription !== undefined) update.seoDescription = data.seoDescription;
      if (data.published !== undefined) update.publishedAt = data.published ? (current.publishedAt ?? new Date()) : null;
      if (data.slug !== undefined) {
        if (current.systemKey === "HOME") {
          if (data.slug.trim() && slugify(data.slug) !== current.slug) throw new ServiceError("INVALID", "The home page slug cannot be changed");
        } else {
          const slug = normalizePageSlug(data.slug);
          if (slug !== current.slug) update.slug = slug; // taken → unique violation → CONFLICT
        }
      }
      if (data.systemKey !== undefined && data.systemKey !== current.systemKey) {
        if (data.systemKey === null) throw new ServiceError("INVALID", "A system page keeps its role; assign the role to another page instead");
        if (current.systemKey) throw new ServiceError("INVALID", `This page already is the ${current.systemKey} page`);
        await tx.contentPage.updateMany({ where: { tenantId: ctx.tenantId, systemKey: data.systemKey }, data: { systemKey: null } });
        update.systemKey = data.systemKey;
      }
      return tx.contentPage.update({ where: { id }, data: update });
    })
    .catch(mapSlugConflict);
  await audit({ action: "content.page.update", ...auditCtx(ctx), entity: "ContentPage", entityId: id, data: { fields: Object.keys(data) } });
  return page;
}

/** Copies a page and its blocks as an unpublished regular page ("<title> (copy)", slug "<slug>-copy[-n]"). */
export async function duplicatePage(ctx: ServiceContext, id: string) {
  const copy = await db
    .$transaction(async (tx) => {
      await lockPage(tx, ctx.tenantId, id);
      const src = await tx.contentPage.findUniqueOrThrow({ where: { id }, include: { blocks: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } });
      const page = await tx.contentPage.create({
        data: {
          tenantId: ctx.tenantId,
          title: `${src.title} (copy)`.slice(0, 200),
          slug: await freePageSlug(tx, ctx.tenantId, `${src.slug}-copy`),
          seoTitle: src.seoTitle,
          seoDescription: src.seoDescription,
          publishedAt: null,
        },
      });
      if (src.blocks.length) {
        await tx.contentBlock.createMany({
          data: src.blocks.map((b, i) => ({
            tenantId: ctx.tenantId,
            pageId: page.id,
            type: b.type,
            data: b.data as Prisma.InputJsonValue,
            sortOrder: i,
            isVisible: b.isVisible,
          })),
        });
      }
      return page;
    })
    .catch(mapSlugConflict);
  await audit({ action: "content.page.duplicate", ...auditCtx(ctx), entity: "ContentPage", entityId: copy.id, data: { sourceId: id } });
  return copy;
}

/**
 * Deletes a regular page with its blocks. System pages → CONFLICT.
 * Menu items linking to the page are removed; an item that has sub-items keeps them and just loses its link.
 */
export async function deletePage(ctx: ServiceContext, id: string) {
  const result = await db.$transaction(async (tx) => {
    await lockPage(tx, ctx.tenantId, id);
    const page = await tx.contentPage.findUniqueOrThrow({ where: { id }, select: { systemKey: true } });
    if (page.systemKey) throw new ServiceError("CONFLICT", "System pages cannot be deleted");
    const linked = await tx.menuItem.findMany({ where: { tenantId: ctx.tenantId, pageId: id }, select: { id: true, _count: { select: { children: true } } } });
    const withChildren = linked.filter((m) => m._count.children > 0).map((m) => m.id);
    const leaves = linked.filter((m) => m._count.children === 0).map((m) => m.id);
    if (withChildren.length) await tx.menuItem.updateMany({ where: { id: { in: withChildren } }, data: { pageId: null } });
    if (leaves.length) await tx.menuItem.deleteMany({ where: { id: { in: leaves } } });
    await tx.contentPage.delete({ where: { id } }); // blocks cascade
    return { removedMenuItems: leaves.length, unlinkedMenuItems: withChildren.length };
  });
  await audit({ action: "content.page.delete", ...auditCtx(ctx), entity: "ContentPage", entityId: id, data: result });
  return result;
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

/**
 * Adds a block (data validated; defaults when omitted). Position: see `AddBlockInput.afterId`.
 * HERO: CONFLICT when the page already has one; always inserted first. Other blocks never go before a HERO.
 * NEWSLETTER_SIGNUP requires the newsletter feature (FORBIDDEN otherwise).
 */
export async function addBlock(ctx: ServiceContext, pageId: string, input: AddBlockInput): Promise<AdminBlock> {
  const req = parseInput(addBlockSchema, input);
  await assertFeature(ctx.tenantId, req.type);
  const block = await validateBlockData(ctx.tenantId, req.type, req.data === undefined ? defaultBlockData(req.type) : req.data);
  const created = await db.$transaction(async (tx) => {
    await lockPage(tx, ctx.tenantId, pageId);
    const blocks = await orderedBlocks(tx, pageId);
    const heroAtTop = blocks[0]?.type === "HERO";
    let index: number;
    if (req.type === "HERO") {
      if (blocks.some((b) => b.type === "HERO")) throw new ServiceError("CONFLICT", "A page can have only one hero block");
      index = 0;
    } else if (req.afterId === undefined) {
      index = blocks.length;
    } else if (req.afterId === null) {
      index = 0;
    } else {
      const at = blocks.findIndex((b) => b.id === req.afterId);
      if (at === -1) throw notFound("Block");
      index = at + 1;
    }
    if (req.type !== "HERO" && heroAtTop && index === 0) index = 1;
    const row = await tx.contentBlock.create({
      data: {
        tenantId: ctx.tenantId,
        pageId,
        type: req.type,
        data: block.data as Prisma.InputJsonValue,
        isVisible: req.isVisible ?? true,
        sortOrder: index,
      },
    });
    const ids = blocks.map((b) => b.id);
    ids.splice(index, 0, row.id);
    await renumber(tx, [...blocks, { id: row.id, sortOrder: index }], ids);
    await touchPage(tx, pageId);
    return row;
  });
  await audit({ action: "content.block.add", ...auditCtx(ctx), entity: "ContentBlock", entityId: created.id, data: { pageId, type: req.type } });
  return toAdminBlock(created);
}

async function requireBlock(tenantId: string, blockId: string) {
  const b = await db.contentBlock.findFirst({ where: { id: blockId, tenantId }, select: { id: true, pageId: true, type: true } });
  if (!b) throw notFound("Block");
  return b;
}

/** Replaces a block's data (validated against its type) and/or toggles visibility. The type never changes. */
export async function updateBlock(ctx: ServiceContext, blockId: string, input: UpdateBlockInput): Promise<AdminBlock> {
  const req = parseInput(updateBlockSchema, input);
  const existing = await requireBlock(ctx.tenantId, blockId);
  const block = req.data !== undefined ? await validateBlockData(ctx.tenantId, existing.type, req.data) : null;
  const updated = await db.$transaction(async (tx) => {
    await lockPage(tx, ctx.tenantId, existing.pageId);
    const row = await tx.contentBlock.update({
      where: { id: blockId },
      data: {
        ...(block ? { data: block.data as Prisma.InputJsonValue } : {}),
        ...(req.isVisible !== undefined ? { isVisible: req.isVisible } : {}),
      },
    });
    await touchPage(tx, existing.pageId);
    return row;
  });
  await audit({ action: "content.block.update", ...auditCtx(ctx), entity: "ContentBlock", entityId: blockId, data: { fields: Object.keys(req) } });
  return toAdminBlock(updated);
}

/** Moves a block to `newIndex` (clamped to the page). A HERO must stay first; nothing may move above it (INVALID). */
export async function moveBlock(ctx: ServiceContext, blockId: string, newIndex: number) {
  const index = parseInput(z.int().min(0), newIndex);
  const existing = await requireBlock(ctx.tenantId, blockId);
  const order = await db.$transaction(async (tx) => {
    await lockPage(tx, ctx.tenantId, existing.pageId);
    const blocks = await orderedBlocks(tx, existing.pageId);
    const ids = blocks.map((b) => b.id).filter((id) => id !== blockId);
    const target = Math.min(index, ids.length);
    const heroAtTop = blocks[0]?.type === "HERO";
    if (existing.type === "HERO" && target !== 0) throw new ServiceError("INVALID", "The hero block must stay first");
    if (existing.type !== "HERO" && heroAtTop && target === 0) throw new ServiceError("INVALID", "Blocks cannot be placed above the hero block");
    ids.splice(target, 0, blockId);
    await renumber(tx, blocks, ids);
    await touchPage(tx, existing.pageId);
    return ids;
  });
  await audit({ action: "content.block.move", ...auditCtx(ctx), entity: "ContentBlock", entityId: blockId, data: { pageId: existing.pageId, index } });
  return order;
}

export async function removeBlock(ctx: ServiceContext, blockId: string) {
  const existing = await requireBlock(ctx.tenantId, blockId);
  await db.$transaction(async (tx) => {
    await lockPage(tx, ctx.tenantId, existing.pageId);
    await tx.contentBlock.delete({ where: { id: blockId } });
    const rest = await orderedBlocks(tx, existing.pageId);
    await renumber(
      tx,
      rest,
      rest.map((b) => b.id),
    );
    await touchPage(tx, existing.pageId);
  });
  await audit({ action: "content.block.remove", ...auditCtx(ctx), entity: "ContentBlock", entityId: blockId, data: { pageId: existing.pageId, type: existing.type } });
}

// ─── System pages ────────────────────────────────────────────────────────────

/**
 * Creates the missing system pages (HOME, TERMS, PRIVACY, CONTACT, ABOUT) for a tenant as unpublished
 * drafts with English starter blocks. Idempotent: existing system pages are never touched. A preferred
 * slug that is already in use falls back to `<slug>-2`, …. Returns the keys it created.
 * Not wired anywhere yet (tenant creation / seed should call it).
 */
export async function ensureSystemPages(tenantId: string): Promise<SystemPageKey[]> {
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"content-system-pages:" + tenantId}))`;
    const existing = await tx.contentPage.findMany({ where: { tenantId, systemKey: { in: [...SYSTEM_PAGE_KEYS] } }, select: { systemKey: true } });
    const have = new Set(existing.map((p) => p.systemKey));
    const missing = SYSTEM_PAGE_KEYS.filter((k) => !have.has(k));
    for (const key of missing) {
      const def = SYSTEM_PAGES[key];
      const taken = await tx.contentPage.findMany({
        where: { tenantId, OR: [{ slug: def.slug }, { slug: { startsWith: `${def.slug}-` } }] },
        select: { slug: true },
      });
      const page = await tx.contentPage.create({
        data: {
          tenantId,
          systemKey: key,
          title: def.title,
          slug: nextFreeSlug(
            def.slug,
            taken.map((t) => t.slug),
          ),
          publishedAt: null,
        },
      });
      await tx.contentBlock.createMany({
        data: SYSTEM_PAGE_STARTER_BLOCKS[key].map((b, i) => ({
          tenantId,
          pageId: page.id,
          type: b.type,
          data: b.data as Prisma.InputJsonValue,
          sortOrder: i,
        })),
      });
    }
    return missing;
  });
  if (created.length) await audit({ action: "content.systemPages.ensure", tenantId, entity: "Tenant", entityId: tenantId, data: { created } });
  return created;
}

// ─── Public read ─────────────────────────────────────────────────────────────

const publishedWhere = () => ({ publishedAt: { not: null, lte: new Date() } }) satisfies Prisma.ContentPageWhereInput;

async function toPublicPage(
  page: (Prisma.ContentPageGetPayload<{ include: { blocks: true } }>) | null,
): Promise<PublicPage | null> {
  if (!page) return null;
  const blocks: PublicBlock[] = [];
  for (const b of page.blocks) {
    const parsed = parseBlock(b.type, b.data);
    if (parsed.ok) blocks.push({ id: b.id, ...parsed.block });
    else console.warn(`[content] skipping invalid ${b.type} block ${b.id} on page ${page.id}: ${parsed.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  }
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    systemKey: page.systemKey,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    updatedAt: page.updatedAt,
    blocks,
  };
}

const visibleBlocks = { blocks: { where: { isVisible: true }, orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] } };

/** A published page by slug with its visible, valid blocks (invalid ones are skipped and logged). Null if absent/draft. */
export async function getPublishedPageBySlug(tenantId: string, slug: string): Promise<PublicPage | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;
  const page = await db.contentPage.findFirst({ where: { tenantId, slug: normalized, ...publishedWhere() }, include: visibleBlocks });
  return toPublicPage(page);
}

/** The published HOME page, or null. */
export async function getHomePage(tenantId: string): Promise<PublicPage | null> {
  const page = await db.contentPage.findFirst({ where: { tenantId, systemKey: "HOME", ...publishedWhere() }, include: visibleBlocks });
  return toPublicPage(page);
}
