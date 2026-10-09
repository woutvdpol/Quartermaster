import "server-only";
import { db } from "@/server/db";
import type { TranslationEntityName } from "./fields";

/*
 * The English source texts per translatable entity, keyed by the logical field names of ./fields.ts.
 * Always tenant-scoped.
 */

export type SourceRow = { entityId: string; fields: Record<string, string | null> };

export type SourceFilter = {
  /** Only these ids (hooks, the job). */
  ids?: string[];
  /** Only rows changed since (cron safety net). */
  since?: Date;
  /** Products only: limit to these statuses (bulk "existing stock"). */
  productStatuses?: ("DRAFT" | "ACTIVE" | "RESERVED" | "SOLD" | "ARCHIVED" | "STOLEN")[];
  /** Keyset paging. */
  after?: string;
  take?: number;
};

/** Short human name of an entity row (admin lists). */
export type SourceLabel = { entityId: string; label: string; href: string | null };

function where(tenantId: string, f: SourceFilter) {
  return {
    tenantId,
    ...(f.ids ? { id: { in: f.ids } } : {}),
    ...(f.after ? { id: { gt: f.after, ...(f.ids ? { in: f.ids } : {}) } } : {}),
    ...(f.since ? { updatedAt: { gte: f.since } } : {}),
  };
}

const page = (f: SourceFilter) => ({ orderBy: { id: "asc" as const }, ...(f.take ? { take: f.take } : {}) });

export async function loadSources(tenantId: string, entity: TranslationEntityName, f: SourceFilter = {}): Promise<SourceRow[]> {
  if (f.ids && f.ids.length === 0) return [];
  switch (entity) {
    case "PRODUCT": {
      const rows = await db.product.findMany({
        where: { ...where(tenantId, f), ...(f.productStatuses ? { status: { in: f.productStatuses } } : {}) },
        select: { id: true, title: true, description: true, seoTitle: true, seoDescription: true },
        ...page(f),
      });
      return rows.map((r) => ({ entityId: r.id, fields: { title: r.title, description: r.description, seoTitle: r.seoTitle, seoDescription: r.seoDescription } }));
    }
    case "CATEGORY": {
      const rows = await db.category.findMany({
        where: where(tenantId, f),
        select: { id: true, title: true, description: true, seoTitle: true, seoDescription: true },
        ...page(f),
      });
      return rows.map((r) => ({ entityId: r.id, fields: { title: r.title, description: r.description, seoTitle: r.seoTitle, seoDescription: r.seoDescription } }));
    }
    case "FACET": {
      const rows = await db.facet.findMany({ where: where(tenantId, f), select: { id: true, name: true }, ...page(f) });
      return rows.map((r) => ({ entityId: r.id, fields: { name: r.name } }));
    }
    case "FACET_VALUE": {
      const rows = await db.facetValue.findMany({ where: where(tenantId, f), select: { id: true, name: true }, ...page(f) });
      return rows.map((r) => ({ entityId: r.id, fields: { label: r.name } }));
    }
    case "CONTENT_PAGE": {
      const rows = await db.contentPage.findMany({ where: where(tenantId, f), select: { id: true, title: true, seoTitle: true, seoDescription: true }, ...page(f) });
      return rows.map((r) => ({ entityId: r.id, fields: { title: r.title, seoTitle: r.seoTitle, seoDescription: r.seoDescription } }));
    }
    case "MENU_ITEM": {
      const rows = await db.menuItem.findMany({ where: where(tenantId, f), select: { id: true, label: true }, ...page(f) });
      return rows.map((r) => ({ entityId: r.id, fields: { label: r.label } }));
    }
  }
}

/** Display names + admin links for a set of entity ids (review queue). */
export async function loadLabels(tenantId: string, entity: TranslationEntityName, ids: string[]): Promise<Map<string, SourceLabel>> {
  const out = new Map<string, SourceLabel>();
  if (!ids.length) return out;
  const put = (entityId: string, label: string, href: string | null) => out.set(entityId, { entityId, label, href });
  switch (entity) {
    case "PRODUCT":
      for (const r of await db.product.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, stockCode: true, title: true } })) {
        put(r.id, `#${r.stockCode} ${r.title}`, `/admin/inventory/${r.id}`);
      }
      break;
    case "CATEGORY":
      for (const r of await db.category.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, title: true } })) put(r.id, r.title, `/admin/categories`);
      break;
    case "FACET":
      for (const r of await db.facet.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } })) put(r.id, r.name, `/admin/facets`);
      break;
    case "FACET_VALUE":
      for (const r of await db.facetValue.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true, facet: { select: { name: true } } } })) {
        put(r.id, `${r.facet.name} › ${r.name}`, `/admin/facets`);
      }
      break;
    case "CONTENT_PAGE":
      for (const r of await db.contentPage.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, title: true } })) put(r.id, r.title, `/admin/pages/${r.id}`);
      break;
    case "MENU_ITEM":
      for (const r of await db.menuItem.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, label: true, location: true } })) {
        put(r.id, `${r.label} (${r.location.toLowerCase()} menu)`, `/admin/menus`);
      }
      break;
  }
  return out;
}

/** SQL table per entity (orphan cleanup). Fixed identifiers, never user input. */
export const ENTITY_TABLES: Record<TranslationEntityName, string> = {
  PRODUCT: "products",
  CATEGORY: "categories",
  FACET: "facets",
  FACET_VALUE: "facet_values",
  CONTENT_PAGE: "content_pages",
  MENU_ITEM: "menu_items",
};
