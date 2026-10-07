import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { notFound, parseInput } from "@/server/catalog/errors";
import type { Prisma } from "@/generated/prisma/client";
import { MenuLocation } from "@/generated/prisma/enums";
import { safeUrlSchema } from "./blocks";
import { sanitizeUrl } from "./url";
import { categoryHref, contentPageHref, MENU_CHILD_LIMIT, MENU_ROOT_LIMITS, SYSTEM_ROUTE_KEYS, SYSTEM_ROUTES, type SystemRouteKey } from "./rules";
import { isExternalUrl } from "./url";

/*
 * Header / footer menus. Two levels, as in legacy: root items (max 7 in the header, max 4 footer
 * columns) with optional sub-items (max MENU_CHILD_LIMIT each). Header roots and all sub-items need a
 * link target; footer roots may be plain column headings.
 *
 * Target storage (no schema change): `pageId` for pages; `url` for everything else —
 *   external/relative URL as typed (sanitised: http/https/mailto/relative),
 *   `qm:category:<id>` for a category (stays valid when the category slug changes),
 *   `qm:route:<key>` for a fixed storefront route (see SYSTEM_ROUTES).
 * The `qm:` scheme is never accepted from user input (sanitizeUrl rejects unknown schemes) and is
 * resolved to a real href by `getPublicMenu`.
 */

type Tx = Prisma.TransactionClient;

const CATEGORY_PREFIX = "qm:category:";
const ROUTE_PREFIX = "qm:route:";

export type MenuTarget =
  | { kind: "page"; pageId: string }
  | { kind: "category"; categoryId: string }
  | { kind: "route"; route: SystemRouteKey }
  | { kind: "url"; url: string };

export type MenuItemView = {
  id: string;
  location: MenuLocation;
  parentId: string | null;
  label: string;
  sortOrder: number;
  target: MenuTarget | null;
  children: MenuItemView[];
};

export type PublicMenuItem = { id: string; label: string; href: string | null; external: boolean; children: PublicMenuItem[] };

const idSchema = z.string().min(1).max(64);
const locationSchema = z.enum(MenuLocation);

export const menuTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), pageId: idSchema }),
  z.object({ kind: z.literal("category"), categoryId: idSchema }),
  z.object({ kind: z.literal("route"), route: z.enum(SYSTEM_ROUTE_KEYS as [SystemRouteKey, ...SystemRouteKey[]]) }),
  z.object({ kind: z.literal("url"), url: safeUrlSchema }),
]);

const labelSchema = z.string().trim().min(1).max(50);

const createSchema = z.object({
  location: locationSchema,
  label: labelSchema,
  parentId: idSchema.nullish(),
  target: menuTargetSchema.nullish(),
});
const updateSchema = z.object({ label: labelSchema.optional(), target: menuTargetSchema.nullable().optional() });
const reorderSchema = z.object({ location: locationSchema, parentId: idSchema.nullable(), orderedIds: z.array(idSchema).max(100) });

export type CreateMenuItemInput = z.input<typeof createSchema>;
export type UpdateMenuItemInput = z.input<typeof updateSchema>;

// ─── Target encoding ─────────────────────────────────────────────────────────

function encodeTarget(t: MenuTarget | null): { url: string | null; pageId: string | null } {
  if (!t) return { url: null, pageId: null };
  switch (t.kind) {
    case "page":
      return { url: null, pageId: t.pageId };
    case "category":
      return { url: CATEGORY_PREFIX + t.categoryId, pageId: null };
    case "route":
      return { url: ROUTE_PREFIX + t.route, pageId: null };
    case "url":
      return { url: t.url, pageId: null };
  }
}

export function decodeTarget(row: { url: string | null; pageId: string | null }): MenuTarget | null {
  if (row.pageId) return { kind: "page", pageId: row.pageId };
  if (!row.url) return null;
  if (row.url.startsWith(CATEGORY_PREFIX)) return { kind: "category", categoryId: row.url.slice(CATEGORY_PREFIX.length) };
  if (row.url.startsWith(ROUTE_PREFIX)) {
    const route = row.url.slice(ROUTE_PREFIX.length);
    return route in SYSTEM_ROUTES ? { kind: "route", route: route as SystemRouteKey } : null;
  }
  return { kind: "url", url: row.url };
}

async function assertTargetExists(tx: Tx, tenantId: string, t: MenuTarget | null | undefined) {
  if (!t) return;
  if (t.kind === "page" && !(await tx.contentPage.findFirst({ where: { id: t.pageId, tenantId }, select: { id: true } }))) {
    throw new ServiceError("INVALID", "Page not found");
  }
  if (t.kind === "category" && !(await tx.category.findFirst({ where: { id: t.categoryId, tenantId }, select: { id: true } }))) {
    throw new ServiceError("INVALID", "Category not found");
  }
}

function assertTargetRequired(location: MenuLocation, isRoot: boolean, target: MenuTarget | null) {
  if (target) return;
  if (!isRoot) throw new ServiceError("INVALID", "A sub-item needs a link");
  if (location === "HEADER") throw new ServiceError("INVALID", "A header menu item needs a link");
}

async function lockMenu(tx: Tx, tenantId: string, location: MenuLocation) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`menu:${tenantId}:${location}`}))`;
}

const auditCtx = (ctx: ServiceContext) => ({ tenantId: ctx.tenantId, actorId: ctx.actor.id });

type Row = { id: string; location: MenuLocation; parentId: string | null; label: string; url: string | null; pageId: string | null; sortOrder: number };

function buildTree(rows: Row[]): MenuItemView[] {
  const views = new Map<string, MenuItemView>(
    rows.map((r) => [r.id, { id: r.id, location: r.location, parentId: r.parentId, label: r.label, sortOrder: r.sortOrder, target: decodeTarget(r), children: [] }]),
  );
  const roots: MenuItemView[] = [];
  for (const r of rows) {
    const v = views.get(r.id)!;
    const parent = r.parentId ? views.get(r.parentId) : undefined;
    if (parent) parent.children.push(v);
    else if (!r.parentId) roots.push(v);
    // Deeper/orphaned rows (only possible from imported data) are ignored.
  }
  return roots;
}

const rowSelect = { id: true, location: true, parentId: true, label: true, url: true, pageId: true, sortOrder: true } as const;
const rowOrder = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

// ─── Admin ───────────────────────────────────────────────────────────────────

/** The menu for `location` as a two-level tree, ordered. */
export async function listMenu(ctx: ServiceContext, location: MenuLocation): Promise<MenuItemView[]> {
  const loc = parseInput(locationSchema, location);
  const rows = await db.menuItem.findMany({ where: { tenantId: ctx.tenantId, location: loc }, select: rowSelect, orderBy: rowOrder });
  return buildTree(rows);
}

/**
 * Appends an item (root, or sub-item when `parentId` is a root item of the same menu).
 * Limits: MENU_ROOT_LIMITS per location, MENU_CHILD_LIMIT per parent → CONFLICT.
 */
export async function createMenuItem(ctx: ServiceContext, input: CreateMenuItemInput): Promise<MenuItemView> {
  const data = parseInput(createSchema, input);
  const parentId = data.parentId ?? null;
  const target = (data.target ?? null) as MenuTarget | null;
  assertTargetRequired(data.location, !parentId, target);
  const row = await db.$transaction(async (tx) => {
    await lockMenu(tx, ctx.tenantId, data.location);
    if (parentId) {
      const parent = await tx.menuItem.findFirst({ where: { id: parentId, tenantId: ctx.tenantId }, select: { location: true, parentId: true } });
      if (!parent) throw notFound("Parent menu item");
      if (parent.location !== data.location) throw new ServiceError("INVALID", "Parent is in another menu");
      if (parent.parentId) throw new ServiceError("INVALID", "Menus have only one level of sub-items");
    }
    const siblings = await tx.menuItem.count({ where: { tenantId: ctx.tenantId, location: data.location, parentId } });
    if (!parentId && siblings >= MENU_ROOT_LIMITS[data.location]) {
      const max = MENU_ROOT_LIMITS[data.location];
      throw new ServiceError(
        "CONFLICT",
        data.location === "HEADER" ? `The header menu can have at most ${max} items` : `The footer can have at most ${max} columns`,
        { limit: max },
      );
    }
    if (parentId && siblings >= MENU_CHILD_LIMIT) {
      throw new ServiceError("CONFLICT", `A menu item can have at most ${MENU_CHILD_LIMIT} sub-items`, { limit: MENU_CHILD_LIMIT });
    }
    await assertTargetExists(tx, ctx.tenantId, target);
    const last = await tx.menuItem.aggregate({ where: { tenantId: ctx.tenantId, location: data.location, parentId }, _max: { sortOrder: true } });
    return tx.menuItem.create({
      data: { tenantId: ctx.tenantId, location: data.location, parentId, label: data.label, ...encodeTarget(target), sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: rowSelect,
    });
  });
  await audit({ action: "content.menu.create", ...auditCtx(ctx), entity: "MenuItem", entityId: row.id, data: { location: row.location, label: row.label } });
  return buildTreeItem(row);
}

function buildTreeItem(row: Row): MenuItemView {
  return { id: row.id, location: row.location, parentId: row.parentId, label: row.label, sortOrder: row.sortOrder, target: decodeTarget(row), children: [] };
}

/** Changes label and/or target (null = no link; only allowed for footer columns). */
export async function updateMenuItem(ctx: ServiceContext, id: string, patch: UpdateMenuItemInput): Promise<MenuItemView> {
  const data = parseInput(updateSchema, patch);
  const current = await db.menuItem.findFirst({ where: { id, tenantId: ctx.tenantId }, select: rowSelect });
  if (!current) throw notFound("Menu item");
  const row = await db.$transaction(async (tx) => {
    await lockMenu(tx, ctx.tenantId, current.location);
    const update: Prisma.MenuItemUncheckedUpdateInput = {};
    if (data.label !== undefined) update.label = data.label;
    if (data.target !== undefined) {
      const target = (data.target ?? null) as MenuTarget | null;
      assertTargetRequired(current.location, !current.parentId, target);
      await assertTargetExists(tx, ctx.tenantId, target);
      Object.assign(update, encodeTarget(target));
    }
    return tx.menuItem.update({ where: { id }, data: update, select: rowSelect });
  });
  await audit({ action: "content.menu.update", ...auditCtx(ctx), entity: "MenuItem", entityId: id, data: { fields: Object.keys(data) } });
  return buildTreeItem(row);
}

/** Deletes an item and its sub-items; remaining siblings are renumbered. */
export async function deleteMenuItem(ctx: ServiceContext, id: string) {
  const current = await db.menuItem.findFirst({ where: { id, tenantId: ctx.tenantId }, select: rowSelect });
  if (!current) throw notFound("Menu item");
  await db.$transaction(async (tx) => {
    await lockMenu(tx, ctx.tenantId, current.location);
    await tx.menuItem.delete({ where: { id } }); // children cascade
    const rest = await tx.menuItem.findMany({
      where: { tenantId: ctx.tenantId, location: current.location, parentId: current.parentId },
      orderBy: rowOrder,
      select: { id: true, sortOrder: true },
    });
    for (const [i, r] of rest.entries()) if (r.sortOrder !== i) await tx.menuItem.update({ where: { id: r.id }, data: { sortOrder: i } });
  });
  await audit({ action: "content.menu.delete", ...auditCtx(ctx), entity: "MenuItem", entityId: id, data: { location: current.location, label: current.label } });
}

/** Sets the order of the root items (`parentId` null) or of one item's sub-items; must list each exactly once. */
export async function reorderMenuItems(ctx: ServiceContext, location: MenuLocation, parentId: string | null, orderedIds: string[]) {
  const data = parseInput(reorderSchema, { location, parentId, orderedIds });
  await db.$transaction(async (tx) => {
    await lockMenu(tx, ctx.tenantId, data.location);
    const siblings = await tx.menuItem.findMany({ where: { tenantId: ctx.tenantId, location: data.location, parentId: data.parentId }, select: { id: true } });
    const set = new Set(siblings.map((s) => s.id));
    if (set.size !== data.orderedIds.length || new Set(data.orderedIds).size !== data.orderedIds.length || !data.orderedIds.every((x) => set.has(x))) {
      throw new ServiceError("INVALID", "orderedIds must list every item of this menu level exactly once");
    }
    for (const [i, mid] of data.orderedIds.entries()) await tx.menuItem.update({ where: { id: mid }, data: { sortOrder: i } });
  });
  await audit({ action: "content.menu.reorder", ...auditCtx(ctx), entity: "MenuItem", entityId: data.parentId ?? data.location });
}

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * The storefront menu with resolved hrefs. Links to unpublished/missing pages and inactive/missing
 * categories lose their href; items left without href and without children are dropped.
 */
export async function getPublicMenu(tenantId: string, location: MenuLocation): Promise<PublicMenuItem[]> {
  const rows = await db.menuItem.findMany({ where: { tenantId, location }, select: rowSelect, orderBy: rowOrder });
  const tree = buildTree(rows);
  const all = tree.flatMap((r) => [r, ...r.children]);
  const pageIds = all.flatMap((v) => (v.target?.kind === "page" ? [v.target.pageId] : []));
  const categoryIds = all.flatMap((v) => (v.target?.kind === "category" ? [v.target.categoryId] : []));
  const now = new Date();
  const [pages, categories] = await Promise.all([
    pageIds.length
      ? db.contentPage.findMany({ where: { tenantId, id: { in: pageIds }, publishedAt: { not: null, lte: now } }, select: { id: true, slug: true, systemKey: true } })
      : [],
    categoryIds.length ? db.category.findMany({ where: { tenantId, id: { in: categoryIds }, isActive: true }, select: { id: true, slug: true } }) : [],
  ]);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const hrefOf = (t: MenuTarget | null): string | null => {
    if (!t) return null;
    switch (t.kind) {
      case "page": {
        const p = pageById.get(t.pageId);
        return p ? contentPageHref(p) : null;
      }
      case "category": {
        const c = catById.get(t.categoryId);
        return c ? categoryHref(c.slug) : null;
      }
      case "route":
        return SYSTEM_ROUTES[t.route].href;
      case "url":
        return sanitizeUrl(t.url); // re-check on read: rows may come from the ETL or older code

    }
  };
  const resolve = (v: MenuItemView): PublicMenuItem | null => {
    const href = hrefOf(v.target);
    const children = v.children.map(resolve).filter((c): c is PublicMenuItem => c !== null);
    if (!href && !children.length) return null;
    return { id: v.id, label: v.label, href, external: href ? isExternalUrl(href) : false, children };
  };
  return tree.map(resolve).filter((c): c is PublicMenuItem => c !== null);
}
