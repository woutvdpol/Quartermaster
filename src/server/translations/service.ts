import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { enqueue } from "@/server/jobs/queue";
import type { Prisma } from "@/generated/prisma/client";
import { parseInput } from "@/server/catalog/errors";
import {
  FIELD_LABELS,
  TRANSLATABLE_FIELDS,
  TRANSLATION_ENTITIES,
  TRANSLATION_LOCALES,
  isMarkdownField,
  isTranslatableField,
  type TranslationEntityName,
  type TranslationLocale,
} from "./fields";
import { SUGGESTED_KEEP_TERMS, SUGGESTED_MAPPED_TERMS } from "./glossary";
import { glossaryFor, translateTexts } from "./machine";
import { loadLabels, loadSources } from "./sources";
import { normalizeSource, sourceHash } from "./state";
import { enabledLocales, kickTranslate } from "./sync";
import { getTranslator, TranslatorUnavailableError } from "./translator";

/*
 * Admin side of translations (docs/i18n.md § Vertalen): overview, review queue, per-entity editor,
 * approve (the only way a translation reaches the shop), "Translate again", glossary, bulk queueing.
 * Every function is tenant-scoped through ctx; mutations are audited ("translation.*", which also
 * invalidates the shop caches — src/server/storefront/cache.ts).
 */

const entityEnum = z.enum(TRANSLATION_ENTITIES as [TranslationEntityName, ...TranslationEntityName[]]);
const localeEnum = z.enum(TRANSLATION_LOCALES);
const cuid = z.string().min(1).max(64);

export const MAX_TRANSLATION_CHARS = 20_000;

// ─── overview ───────────────────────────────────────────────────────────────

export type LocaleCounts = { queued: number; machine: number; approved: number; stale: number };
export type TranslationOverview = {
  locales: TranslationLocale[];
  counts: Record<TranslationLocale, LocaleCounts>;
  /** Machine translation possible in this process (embedder configured). */
  translatorConfigured: boolean;
};

export async function getTranslationOverview(ctx: ServiceContext): Promise<TranslationOverview> {
  const [locales, grouped, stale] = await Promise.all([
    enabledLocales(ctx.tenantId),
    db.translation.groupBy({ by: ["locale", "status"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    db.translation.groupBy({ by: ["locale"], where: { tenantId: ctx.tenantId, status: "APPROVED", stale: true }, _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(TRANSLATION_LOCALES.map((l) => [l, { queued: 0, machine: 0, approved: 0, stale: 0 }])) as Record<TranslationLocale, LocaleCounts>;
  for (const g of grouped) {
    const c = counts[g.locale as TranslationLocale];
    if (!c) continue;
    if (g.status === "QUEUED") c.queued = g._count._all;
    if (g.status === "MACHINE") c.machine = g._count._all;
    if (g.status === "APPROVED") c.approved = g._count._all;
  }
  for (const g of stale) if (counts[g.locale as TranslationLocale]) counts[g.locale as TranslationLocale].stale = g._count._all;
  return { locales, counts, translatorConfigured: getTranslator() !== null };
}

// ─── per-entity editor (product editor card) ───────────────────────────────

export type TranslationCell = {
  status: "QUEUED" | "MACHINE" | "APPROVED" | null;
  value: string | null;
  stale: boolean;
  approvedAt: string | null;
};

export type EntityTranslationField = {
  field: string;
  label: string;
  markdown: boolean;
  source: string | null;
  cells: Partial<Record<TranslationLocale, TranslationCell>>;
};

export type EntityTranslations = { locales: TranslationLocale[]; fields: EntityTranslationField[] };

export async function getEntityTranslations(ctx: ServiceContext, entity: TranslationEntityName, entityId: string): Promise<EntityTranslations> {
  entity = parseInput(entityEnum, entity);
  const [locales, sources, rows] = await Promise.all([
    enabledLocales(ctx.tenantId),
    loadSources(ctx.tenantId, entity, { ids: [entityId] }),
    db.translation.findMany({ where: { tenantId: ctx.tenantId, entity, entityId } }),
  ]);
  if (!sources.length) throw new ServiceError("NOT_FOUND", "Not found");
  const src = sources[0].fields;
  return {
    locales,
    fields: TRANSLATABLE_FIELDS[entity].map((field) => ({
      field,
      label: FIELD_LABELS[field] ?? field,
      markdown: isMarkdownField(entity, field),
      source: normalizeSource(src[field]),
      cells: Object.fromEntries(
        locales.map((l) => {
          const r = rows.find((x) => x.field === field && x.locale === l);
          return [l, r ? { status: r.status, value: r.value, stale: r.stale, approvedAt: r.approvedAt?.toISOString() ?? null } : { status: null, value: null, stale: false, approvedAt: null }];
        }),
      ),
    })),
  };
}

// ─── review queue ───────────────────────────────────────────────────────────

export type ReviewView = "review" | "queued" | "approved" | "all";

export type ReviewRow = {
  id: string;
  entity: TranslationEntityName;
  entityId: string;
  field: string;
  fieldLabel: string;
  locale: TranslationLocale;
  status: "QUEUED" | "MACHINE" | "APPROVED";
  stale: boolean;
  value: string | null;
  source: string | null;
  markdown: boolean;
  label: string;
  href: string | null;
  updatedAt: string;
};

const listSchema = z.object({
  view: z.enum(["review", "queued", "approved", "all"]).default("review"),
  locale: localeEnum.optional(),
  entity: entityEnum.optional(),
  page: z.int().min(1).max(10_000).default(1),
  pageSize: z.int().min(1).max(100).default(25),
});

function viewWhere(view: ReviewView): Prisma.TranslationWhereInput {
  switch (view) {
    case "review":
      return { OR: [{ status: "MACHINE" }, { status: "APPROVED", stale: true }] };
    case "queued":
      return { status: "QUEUED" };
    case "approved":
      return { status: "APPROVED" };
    default:
      return {};
  }
}

export async function listTranslations(
  ctx: ServiceContext,
  input: z.input<typeof listSchema>,
): Promise<{ rows: ReviewRow[]; total: number; counts: Record<ReviewView, number> }> {
  const f = parseInput(listSchema, input);
  const base: Prisma.TranslationWhereInput = {
    tenantId: ctx.tenantId,
    locale: f.locale ? f.locale : { in: [...(await enabledLocales(ctx.tenantId))] },
    ...(f.entity ? { entity: f.entity } : {}),
  };
  const where = { ...base, ...viewWhere(f.view) };
  const [rows, total, review, queued, approved, all] = await Promise.all([
    db.translation.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    db.translation.count({ where }),
    db.translation.count({ where: { ...base, ...viewWhere("review") } }),
    db.translation.count({ where: { ...base, ...viewWhere("queued") } }),
    db.translation.count({ where: { ...base, ...viewWhere("approved") } }),
    db.translation.count({ where: base }),
  ]);

  // Source texts + display names per entity type, in one query each.
  const byEntity = new Map<TranslationEntityName, string[]>();
  for (const r of rows) byEntity.set(r.entity, [...(byEntity.get(r.entity) ?? []), r.entityId]);
  const sources = new Map<string, Record<string, string | null>>();
  const labels = new Map<string, { label: string; href: string | null }>();
  await Promise.all(
    [...byEntity].map(async ([entity, ids]) => {
      const unique = [...new Set(ids)];
      const [src, lab] = await Promise.all([loadSources(ctx.tenantId, entity, { ids: unique }), loadLabels(ctx.tenantId, entity, unique)]);
      for (const s of src) sources.set(`${entity}|${s.entityId}`, s.fields);
      for (const [id, l] of lab) labels.set(`${entity}|${id}`, l);
    }),
  );

  return {
    rows: rows.map((r) => {
      const key = `${r.entity}|${r.entityId}`;
      const l = labels.get(key);
      return {
        id: r.id,
        entity: r.entity,
        entityId: r.entityId,
        field: r.field,
        fieldLabel: FIELD_LABELS[r.field] ?? r.field,
        locale: r.locale as TranslationLocale,
        status: r.status,
        stale: r.stale,
        value: r.value,
        source: normalizeSource(sources.get(key)?.[r.field]),
        markdown: isMarkdownField(r.entity, r.field),
        label: l?.label ?? "(deleted)",
        href: l?.href ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    }),
    total,
    counts: { review, queued, approved, all },
  };
}

// ─── approve ────────────────────────────────────────────────────────────────

const cellSchema = z.object({
  entity: entityEnum,
  entityId: cuid,
  field: z.string().min(1).max(40),
  locale: localeEnum,
});

const approveSchema = cellSchema.extend({ value: z.string().max(MAX_TRANSLATION_CHARS) });

async function currentSource(ctx: ServiceContext, entity: TranslationEntityName, entityId: string, field: string): Promise<string> {
  if (!isTranslatableField(entity, field)) throw new ServiceError("INVALID", "This field is not translated.");
  const [src] = await loadSources(ctx.tenantId, entity, { ids: [entityId] });
  if (!src) throw new ServiceError("NOT_FOUND", "Not found");
  const text = normalizeSource(src.fields[field]);
  if (text === null) throw new ServiceError("INVALID", "The English text is empty; there is nothing to translate.");
  return text;
}

/**
 * Approve & publish: stores the (possibly edited) translation as APPROVED for the current English
 * text. From now on the shop shows it in that language.
 */
export async function approveTranslation(ctx: ServiceContext, input: z.input<typeof approveSchema>): Promise<{ id: string }> {
  const data = parseInput(approveSchema, input);
  const value = data.value.replace(/\r\n?/g, "\n").trim();
  if (!value) throw new ServiceError("INVALID", "Enter a translation before approving.");
  const source = await currentSource(ctx, data.entity, data.entityId, data.field);
  const now = new Date();
  const set = { value, status: "APPROVED" as const, sourceHash: sourceHash(source), stale: false, approvedAt: now, approvedBy: ctx.actor.id };
  const row = await db.translation.upsert({
    where: { tenantId_entity_entityId_field_locale: { tenantId: ctx.tenantId, entity: data.entity, entityId: data.entityId, field: data.field, locale: data.locale } },
    create: { tenantId: ctx.tenantId, entity: data.entity, entityId: data.entityId, field: data.field, locale: data.locale, ...set },
    update: set,
    select: { id: true },
  });
  await audit({
    action: "translation.approve",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Translation",
    entityId: row.id,
    data: { entity: data.entity, entityId: data.entityId, field: data.field, locale: data.locale },
  });
  return row;
}

/**
 * Bulk approve from the review queue: machine proposals as they are, and stale approved rows as
 * "still correct" (keeps the value, confirms it for the current English text).
 */
export async function approveMany(ctx: ServiceContext, ids: string[]): Promise<{ approved: number; skipped: number }> {
  const list = parseInput(z.array(cuid).min(1).max(200), ids);
  const rows = await db.translation.findMany({ where: { tenantId: ctx.tenantId, id: { in: list } } });
  let approved = 0;
  const now = new Date();
  for (const r of rows) {
    if (r.status === "QUEUED" || !r.value || !(r.status === "MACHINE" || r.stale)) continue;
    const [src] = await loadSources(ctx.tenantId, r.entity, { ids: [r.entityId] });
    const text = normalizeSource(src?.fields[r.field]);
    if (text === null) continue;
    const done = await db.translation.updateMany({
      where: { id: r.id, tenantId: ctx.tenantId, status: r.status, updatedAt: r.updatedAt },
      data: { status: "APPROVED", stale: false, sourceHash: sourceHash(text), approvedAt: now, approvedBy: ctx.actor.id },
    });
    approved += done.count;
  }
  if (approved) {
    await audit({ action: "translation.approve_bulk", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Translation", entityId: "bulk", data: { approved, requested: list.length } });
  }
  return { approved, skipped: list.length - approved };
}

/** Takes an approved translation offline again (back to an unreviewed proposal). */
export async function withdrawTranslation(ctx: ServiceContext, input: z.input<typeof cellSchema>): Promise<void> {
  const data = parseInput(cellSchema, input);
  const done = await db.translation.updateMany({
    where: { tenantId: ctx.tenantId, entity: data.entity, entityId: data.entityId, field: data.field, locale: data.locale, status: "APPROVED" },
    data: { status: "MACHINE", stale: false, approvedAt: null, approvedBy: null },
  });
  if (!done.count) throw new ServiceError("NOT_FOUND", "No approved translation to withdraw.");
  await audit({ action: "translation.withdraw", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Translation", entityId: data.entityId, data });
}

// ─── machine translation on demand ─────────────────────────────────────────

/**
 * "Translate again": a fresh machine translation of the current English text, computed now. Rows
 * that are not approved store it as their MACHINE proposal; approved rows only get it as a
 * suggestion for the editor (what is online changes only on approve).
 */
export async function suggestTranslation(ctx: ServiceContext, input: z.input<typeof cellSchema>): Promise<{ value: string; missing: number; stored: boolean }> {
  const data = parseInput(cellSchema, input);
  const source = await currentSource(ctx, data.entity, data.entityId, data.field);
  const translator = getTranslator();
  if (!translator) throw new ServiceError("UNAVAILABLE", "Machine translation is not configured on this server.");
  let out: { text: string; missing: number };
  try {
    [out] = await translateTexts(translator, data.locale, [{ text: source, markdown: isMarkdownField(data.entity, data.field) }], await glossaryFor(ctx.tenantId, data.locale));
  } catch (err) {
    if (err instanceof TranslatorUnavailableError) throw new ServiceError("UNAVAILABLE", "The translator is not reachable right now. Try again in a minute.");
    throw err;
  }
  const hash = sourceHash(source);
  const key = { tenantId: ctx.tenantId, entity: data.entity, entityId: data.entityId, field: data.field, locale: data.locale };
  const existing = await db.translation.findUnique({ where: { tenantId_entity_entityId_field_locale: key }, select: { status: true } });
  let stored = false;
  if (!existing) {
    await db.translation.create({ data: { ...key, value: out.text, status: "MACHINE", sourceHash: hash } });
    stored = true;
  } else if (existing.status !== "APPROVED") {
    stored = (await db.translation.updateMany({ where: { ...key, status: { not: "APPROVED" } }, data: { value: out.text, status: "MACHINE", sourceHash: hash, stale: false } })).count > 0;
  }
  return { value: out.text, missing: out.missing, stored };
}

/** After glossary changes: send every unreviewed proposal of a language through the translator again. */
export async function retranslateUnreviewed(ctx: ServiceContext, locale: TranslationLocale): Promise<{ queued: number }> {
  const l = parseInput(localeEnum, locale);
  const done = await db.translation.updateMany({ where: { tenantId: ctx.tenantId, locale: l, status: "MACHINE" }, data: { status: "QUEUED" } });
  if (done.count) {
    await kickTranslate(ctx.tenantId);
    await audit({ action: "translation.retranslate", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Translation", entityId: l, data: { queued: done.count } });
  }
  return { queued: done.count };
}

/**
 * "Translate existing stock": queues every translatable text of the shop (unsold products, or all
 * products with `includeSold`) for the enabled languages. Runs in the background.
 */
export async function queueExisting(ctx: ServiceContext, opts: { includeSold?: boolean } = {}): Promise<void> {
  if (!(await enabledLocales(ctx.tenantId)).length) throw new ServiceError("INVALID", "Switch on a shop language first.");
  await enqueue("translations.sync", { tenantId: ctx.tenantId, scope: opts.includeSold ? "all" : "stock" }, { singletonKey: `tenant:${ctx.tenantId}` });
  await audit({ action: "translation.queue_existing", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tenant", entityId: ctx.tenantId, data: { includeSold: !!opts.includeSold } });
}

// ─── glossary ───────────────────────────────────────────────────────────────

export type GlossaryRow = { id: string; locale: TranslationLocale; source: string; target: string | null };

export async function listGlossary(ctx: ServiceContext, locale?: TranslationLocale): Promise<GlossaryRow[]> {
  const rows = await db.translationTerm.findMany({
    where: { tenantId: ctx.tenantId, ...(locale ? { locale: parseInput(localeEnum, locale) } : {}) },
    orderBy: [{ locale: "asc" }, { source: "asc" }],
  });
  return rows.map((r) => ({ id: r.id, locale: r.locale as TranslationLocale, source: r.source, target: r.target }));
}

const termSchema = z.object({
  locale: localeEnum,
  source: z.string().trim().min(1, "Enter the English term.").max(100).transform((s) => s.replace(/\s+/g, " ")),
  /** null or "" = never translate. */
  target: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((s) => (s ? s.replace(/\s+/g, " ") : null)),
});

/** Adds or changes a term (one per English term and language, case-insensitive). */
export async function saveGlossaryTerm(ctx: ServiceContext, input: z.input<typeof termSchema>): Promise<GlossaryRow> {
  const data = parseInput(termSchema, input);
  const existing = await db.translationTerm.findFirst({
    where: { tenantId: ctx.tenantId, locale: data.locale, source: { equals: data.source, mode: "insensitive" } },
  });
  const row = existing
    ? await db.translationTerm.update({ where: { id: existing.id }, data: { source: data.source, target: data.target } })
    : await db.translationTerm.create({ data: { tenantId: ctx.tenantId, ...data } });
  await audit({ action: "translation.term_save", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "TranslationTerm", entityId: row.id, data });
  return { id: row.id, locale: row.locale as TranslationLocale, source: row.source, target: row.target };
}

export async function deleteGlossaryTerm(ctx: ServiceContext, id: string): Promise<void> {
  const done = await db.translationTerm.deleteMany({ where: { tenantId: ctx.tenantId, id: parseInput(cuid, id) } });
  if (!done.count) throw new ServiceError("NOT_FOUND", "Term not found");
  await audit({ action: "translation.term_delete", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "TranslationTerm", entityId: id });
}

/** Adds the suggested collector terms (never-translate names and term translations) that are not in the glossary yet. */
export async function addSuggestedTerms(ctx: ServiceContext, locale: TranslationLocale): Promise<{ added: number }> {
  const l = parseInput(localeEnum, locale);
  const have = new Set((await db.translationTerm.findMany({ where: { tenantId: ctx.tenantId, locale: l }, select: { source: true } })).map((t) => t.source.toLowerCase()));
  const suggested = [...SUGGESTED_KEEP_TERMS.map((source) => ({ source, target: null as string | null })), ...SUGGESTED_MAPPED_TERMS[l]];
  const data = suggested.filter((t) => !have.has(t.source.toLowerCase())).map((t) => ({ tenantId: ctx.tenantId, locale: l, source: t.source, target: t.target }));
  if (data.length) {
    await db.translationTerm.createMany({ data, skipDuplicates: true });
    await audit({ action: "translation.term_suggested", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "TranslationTerm", entityId: l, data: { added: data.length } });
  }
  return { added: data.length };
}
