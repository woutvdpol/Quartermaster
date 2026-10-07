import { nextFreeSlug, slugify } from "../../../src/server/catalog/slug";
import { DEFAULT_FACETS, type DefaultValue } from "../../../src/server/facets/defaults";
import { FACET_KINDS, type FacetKindName } from "../../../src/server/facets/tree";
import type { EtlContext, Tx } from "../context";

/**
 * Facets (docs/etl/facets.md):
 *  1. the standard facets + starter values (same data and matching rules as seedDefaultFacets:
 *     facets by slug, values by case-insensitive name within the facet; existing rows untouched);
 *  2. optionally a mapping CSV `legacy_tag_id,facet_kind,value_name,parent` that turns legacy tags into
 *     facet values (FacetValue.legacyTagId) and links their products — like convertTagsToFacet, but
 *     the tags are kept (the shop hides tags that are mapped to a facet value).
 * Implemented on the step transaction (the facet services use their own transactions, which would
 * escape a dry run).
 */

export type FacetMapRow = { legacyTagId: number; kind: FacetKindName; customName: string | null; valueName: string; parent: string | null };

/** Parses the facet mapping CSV. Lines starting with # and the header are ignored. */
export function parseFacetMapCsv(csv: string): { rows: FacetMapRow[]; errors: string[] } {
  const rows: FacetMapRow[] = [];
  const errors: string[] = [];
  const lines = csv.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cells = splitCsvLine(line);
    if (i === 0 && cells[0]?.toLowerCase() === "legacy_tag_id") continue;
    const [idRaw, kindRaw, valueName, parent] = cells.map((c) => c.trim());
    const legacyTagId = Number(idRaw);
    let kind = (kindRaw ?? "").toUpperCase();
    let customName: string | null = null;
    if (kind.startsWith("CUSTOM:")) {
      customName = (kindRaw ?? "").slice(7).trim();
      kind = "CUSTOM";
    }
    if (!Number.isInteger(legacyTagId) || legacyTagId <= 0) errors.push(`line ${i + 1}: invalid legacy_tag_id`);
    else if (!(FACET_KINDS as readonly string[]).includes(kind)) errors.push(`line ${i + 1}: unknown facet_kind`);
    else if (kind === "CUSTOM" && !customName) errors.push(`line ${i + 1}: CUSTOM needs "CUSTOM:<facet name>"`);
    else if (!valueName) errors.push(`line ${i + 1}: value_name is empty`);
    else rows.push({ legacyTagId, kind: kind as FacetKindName, customName, valueName, parent: parent || null });
  }
  return { rows, errors };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function uniqueValueSlug(tx: Tx, facetId: string, wanted: string) {
  const base = slugify(wanted) || "value";
  const rows = await tx.facetValue.findMany({ where: { facetId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] }, select: { slug: true } });
  return nextFreeSlug(base, rows.map((r) => r.slug));
}

async function nextSortOrder(tx: Tx, facetId: string, parentId: string | null) {
  const agg = await tx.facetValue.aggregate({ where: { facetId, parentId }, _max: { sortOrder: true } });
  return (agg._max.sortOrder ?? -1) + 1;
}

async function ensureValue(tx: Tx, tenantId: string, facetId: string, name: string, parentId: string | null): Promise<{ id: string; created: boolean }> {
  const existing = await tx.facetValue.findMany({ where: { facetId }, select: { id: true, name: true, parentId: true } });
  const matches = existing.filter((v) => v.name.trim().toLowerCase() === name.trim().toLowerCase());
  const hit = matches.find((v) => v.parentId === parentId) ?? matches[0];
  if (hit) return { id: hit.id, created: false };
  const row = await tx.facetValue.create({
    data: { tenantId, facetId, parentId, name: name.trim(), slug: await uniqueValueSlug(tx, facetId, name), sortOrder: await nextSortOrder(tx, facetId, parentId) },
  });
  return { id: row.id, created: true };
}

export async function facetsStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;

  // 1. Standard facets.
  let order = ((await tx.facet.aggregate({ where: { tenantId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
  for (const def of DEFAULT_FACETS) {
    let facet = await tx.facet.findFirst({ where: { tenantId, slug: def.slug } });
    if (!facet) {
      facet = await tx.facet.create({ data: { tenantId, kind: def.kind, name: def.name, slug: def.slug, sortOrder: order++ } });
      report.created("facets");
    } else report.unchanged("facets");
    const walk = async (values: readonly DefaultValue[], parentId: string | null) => {
      for (const v of values) {
        const res = await ensureValue(tx, tenantId, facet!.id, v.name, parentId);
        if (res.created) report.created("facet values");
        if (v.children?.length) await walk(v.children, res.id);
      }
    };
    await walk(def.values, null);
  }

  // 2. Optional tag → facet mapping.
  if (!ctx.options.facetMapCsv) {
    report.note("Facetten", "Geen mappingbestand (--facet-map): legacy tags blijven gewone tags.");
    return;
  }
  const { rows, errors } = parseFacetMapCsv(ctx.options.facetMapCsv);
  for (const e of errors) report.warn(`facet map: ${e}`);
  report.legacy("facet mappings", rows.length);
  const tags = new Map((await tx.tag.findMany({ where: { tenantId, legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((t) => [t.legacyId!, t.id]));
  for (const row of rows) {
    const tagId = tags.get(row.legacyTagId);
    if (!tagId) {
      report.skip("facet mappings", "tag niet geïmporteerd");
      continue;
    }
    let facet = row.kind === "CUSTOM"
      ? await tx.facet.findFirst({ where: { tenantId, kind: "CUSTOM", name: { equals: row.customName!, mode: "insensitive" } } })
      : await tx.facet.findFirst({ where: { tenantId, kind: row.kind }, orderBy: { sortOrder: "asc" } });
    if (!facet) {
      const name = row.customName ?? row.kind.charAt(0) + row.kind.slice(1).toLowerCase();
      const taken = (await tx.facet.findMany({ where: { tenantId }, select: { slug: true } })).map((f) => f.slug);
      facet = await tx.facet.create({ data: { tenantId, kind: row.kind, name, slug: nextFreeSlug(slugify(name) || "facet", taken), sortOrder: order++ } });
      report.created("facets");
    }
    const parentId = row.parent ? (await ensureValue(tx, tenantId, facet.id, row.parent, null)).id : null;
    const value = await ensureValue(tx, tenantId, facet.id, row.valueName, parentId);
    if (value.created) report.created("facet values");
    const v = await tx.facetValue.findUniqueOrThrow({ where: { id: value.id } });
    if (v.legacyTagId === null) await tx.facetValue.update({ where: { id: v.id }, data: { legacyTagId: row.legacyTagId } });
    const links = await tx.productTag.findMany({ where: { tenantId, tagId }, select: { productId: true } });
    const res = await tx.productFacetValue.createMany({
      data: links.map((l) => ({ tenantId, productId: l.productId, facetValueId: v.id })),
      skipDuplicates: true,
    });
    report.created("product facet values", res.count);
    report.created("facet mappings");
  }
}
