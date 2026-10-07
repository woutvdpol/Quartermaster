import type { EtlContext } from "../context";
import { assignUniqueSlugs } from "../transforms/slugs";

/** Unique display name: "Name", "Name (2)", … against `taken` (case-insensitive). */
function uniqueName(name: string, taken: Set<string>): string {
  const base = name.trim().slice(0, 190) || "Untitled";
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Legacy `categories` → Category (upsert on legacyId; parent links in a second pass). */
export async function categoriesStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const rows = await ctx.legacy.read("categories");
  report.legacy("categories", rows.length);

  const existing = await tx.category.findMany({ where: { tenantId }, select: { id: true, legacyId: true, slug: true, title: true, isActive: true, parentId: true } });
  const byLegacy = new Map(existing.filter((c) => c.legacyId !== null).map((c) => [c.legacyId!, c]));
  const reserved = existing.filter((c) => c.legacyId === null).map((c) => c.slug);
  const { slugs, collisions } = assignUniqueSlugs(
    rows.map((r) => ({ key: r.id, slug: r.slug, title: r.title, fallback: `category-${r.id}` })),
    reserved,
  );
  for (const c of collisions) report.note("Slug-botsingen", `categorie legacy #${c.key}: "${c.wanted}" → "${c.assigned}"`);

  // Free slugs that move between rows first, so the unique index never sees a transient duplicate.
  for (const r of rows) {
    const cur = byLegacy.get(r.id);
    if (cur && cur.slug !== slugs.get(r.id)) await tx.category.update({ where: { id: cur.id }, data: { slug: `etl-tmp-${r.id}` } });
  }

  const idByLegacy = new Map<number, string>();
  for (const r of rows) {
    const data = { title: r.title.trim() || `Category ${r.id}`, slug: slugs.get(r.id)!, isActive: !!r.active };
    const cur = byLegacy.get(r.id);
    if (cur) {
      const changed = cur.title !== data.title || cur.slug !== data.slug || cur.isActive !== data.isActive;
      if (changed) await tx.category.update({ where: { id: cur.id }, data });
      if (changed) report.updated("categories");
      else report.unchanged("categories");
      idByLegacy.set(r.id, cur.id);
    } else {
      const row = await tx.category.create({ data: { tenantId, legacyId: r.id, ...data, ...(r.created_at ? { createdAt: r.created_at } : {}) } });
      report.created("categories");
      idByLegacy.set(r.id, row.id);
    }
  }
  for (const r of rows) {
    const parentId = r.parent_id !== null ? (idByLegacy.get(r.parent_id) ?? null) : null;
    if (r.parent_id !== null && !parentId) report.warn(`category legacy #${r.id}: parent #${r.parent_id} not found → top level`);
    const id = idByLegacy.get(r.id)!;
    const cur = byLegacy.get(r.id);
    if (!cur || cur.parentId !== parentId) await tx.category.update({ where: { id }, data: { parentId: parentId === id ? null : parentId } });
  }
}

/** Legacy `tags` → Tag (upsert on legacyId; slug from the name; duplicate names get a suffix). */
export async function tagsStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const rows = await ctx.legacy.read("tags");
  report.legacy("tags", rows.length);
  const existing = await tx.tag.findMany({ where: { tenantId } });
  const byLegacy = new Map(existing.filter((t) => t.legacyId !== null).map((t) => [t.legacyId!, t]));
  const foreign = existing.filter((t) => t.legacyId === null);
  const { slugs, collisions } = assignUniqueSlugs(
    rows.map((r) => ({ key: r.id, slug: r.name, title: r.name, fallback: `tag-${r.id}` })),
    foreign.map((t) => t.slug),
  );
  for (const c of collisions) report.note("Slug-botsingen", `tag legacy #${c.key}: "${c.wanted}" → "${c.assigned}"`);
  const takenNames = new Set(foreign.map((t) => t.name.toLowerCase()));
  const names = new Map(rows.map((r) => [r.id, uniqueName(r.name, takenNames)]));
  for (const r of rows) if (names.get(r.id) !== r.name.trim()) report.note("Tags: dubbele namen", `tag legacy #${r.id} hernoemd met suffix`);

  for (const r of rows) {
    const cur = byLegacy.get(r.id);
    if (cur && (cur.slug !== slugs.get(r.id) || cur.name !== names.get(r.id))) {
      await tx.tag.update({ where: { id: cur.id }, data: { slug: `etl-tmp-${r.id}`, name: `etl-tmp-${r.id}` } });
    }
  }
  for (const r of rows) {
    const data = { name: names.get(r.id)!, slug: slugs.get(r.id)!, description: r.description?.trim() || null };
    const cur = byLegacy.get(r.id);
    if (cur) {
      const changed = cur.name !== data.name || cur.slug !== data.slug || cur.description !== data.description;
      if (changed) await tx.tag.update({ where: { id: cur.id }, data });
      if (changed) report.updated("tags");
      else report.unchanged("tags");
    } else {
      await tx.tag.create({ data: { tenantId, legacyId: r.id, ...data } });
      report.created("tags");
    }
    if (r.deleted_at) report.note("Tags", `tag legacy #${r.id} had deleted_at (unused column in legacy) → imported`);
  }
}

/** Legacy `product_origins` → Supplier, `purchase_records` → PurchaseRecord (internal purchasing). */
export async function purchasingStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const origins = await ctx.legacy.read("product_origins");
  const records = await ctx.legacy.read("purchase_records");
  report.legacy("suppliers", origins.length);
  report.legacy("purchase records", records.length);

  const suppliers = await tx.supplier.findMany({ where: { tenantId } });
  const supplierByLegacy = new Map(suppliers.filter((s) => s.legacyId !== null).map((s) => [s.legacyId!, s]));
  const takenNames = new Set(suppliers.filter((s) => s.legacyId === null).map((s) => s.name.toLowerCase()));
  const supplierIds = new Map<number, string>();
  for (const o of origins) {
    const name = uniqueName(o.name, takenNames);
    const cur = supplierByLegacy.get(o.id);
    if (cur) {
      if (cur.name !== name) {
        await tx.supplier.update({ where: { id: cur.id }, data: { name } });
        report.updated("suppliers");
      } else report.unchanged("suppliers");
      supplierIds.set(o.id, cur.id);
    } else {
      const row = await tx.supplier.create({ data: { tenantId, legacyId: o.id, name } });
      supplierIds.set(o.id, row.id);
      report.created("suppliers");
    }
  }

  const existing = new Map(
    (await tx.purchaseRecord.findMany({ where: { tenantId, legacyId: { not: null } } })).map((p) => [p.legacyId!, p]),
  );
  for (const r of records) {
    const data = {
      supplierId: r.product_origin_id !== null ? (supplierIds.get(r.product_origin_id) ?? null) : null,
      invoiceNumber: r.invoice_number?.trim() || null,
      // Legacy has no purchase date column: created_at is the best approximation.
      purchasedAt: r.created_at ?? ctx.now,
      currency: ctx.currency,
    };
    const cur = existing.get(r.id);
    if (cur) {
      await tx.purchaseRecord.update({ where: { id: cur.id }, data });
      report.updated("purchase records");
    } else {
      await tx.purchaseRecord.create({ data: { tenantId, legacyId: r.id, ...data } });
      report.created("purchase records");
    }
  }
}
