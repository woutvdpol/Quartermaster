import "server-only";
import { db } from "@/server/db";
import { isMarkdownField, type TranslationEntityName, type TranslationLocale } from "./fields";
import type { GlossaryTerm } from "./glossary";
import { loadSources } from "./sources";
import { normalizeSource, sourceHash } from "./state";
import { prepareText } from "./text";
import { getTranslator, type Translator } from "./translator";
import { enabledLocales, kickTranslate } from "./sync";

/*
 * The machine half: QUEUED rows → embedder /translate → MACHINE (job `translations.translate`), and
 * the live "Translate again" of the admin. Never makes anything visible in the shop: only a reviewer's
 * approve does (./service.ts).
 */

export type TextJob = { text: string; markdown: boolean };

/** Translates several texts into one language with as few embedder calls as possible. */
export async function translateTexts(
  translator: Translator,
  locale: TranslationLocale,
  jobs: TextJob[],
  terms: readonly GlossaryTerm[],
  signal?: AbortSignal,
): Promise<{ text: string; missing: number }[]> {
  const prepared = jobs.map((j) => prepareText(j.text, { markdown: j.markdown, terms }));
  const units = prepared.flatMap((p) => p.units);
  const translated = units.length ? await translator.translate(locale, units, { signal }) : [];
  let offset = 0;
  return prepared.map((p) => {
    const mine = translated.slice(offset, offset + p.units.length);
    offset += p.units.length;
    return p.assemble(mine);
  });
}

export async function glossaryFor(tenantId: string, locale: TranslationLocale): Promise<GlossaryTerm[]> {
  return db.translationTerm.findMany({ where: { tenantId, locale }, select: { source: true, target: true } });
}

/** Rows per round trip; ≈ 40 sentences, a few seconds of embedder CPU. */
const ROWS_PER_ROUND = 12;
const SLICE_MS = 4 * 60 * 1000;

export type ProcessResult = { translated: number; dropped: number; missingTokens: number; remaining: number; skipped?: string };

/**
 * Works through the QUEUED rows of one tenant for at most ~4 minutes, then queues itself again when
 * rows remain. Embedder errors propagate (pg-boss retries with backoff); rows simply stay QUEUED.
 */
export async function processQueue(tenantId: string, opts: { signal?: AbortSignal; sliceMs?: number; translator?: Translator | null } = {}): Promise<ProcessResult> {
  const result: ProcessResult = { translated: 0, dropped: 0, missingTokens: 0, remaining: 0 };
  const translator = opts.translator === undefined ? getTranslator() : opts.translator;
  const locales = await enabledLocales(tenantId);
  const queued = () => db.translation.count({ where: { tenantId, status: "QUEUED", locale: { in: [...locales] } } });
  if (!locales.length) return { ...result, skipped: "no shop languages enabled" };
  if (!translator) return { ...result, remaining: await queued(), skipped: "no translator configured (EMBEDDER_URL)" };

  const started = Date.now();
  const sliceMs = opts.sliceMs ?? SLICE_MS;
  const glossaries = new Map<TranslationLocale, GlossaryTerm[]>();
  for (const l of locales) glossaries.set(l, await glossaryFor(tenantId, l));

  // Taxonomy first (short, shared by many products), then products oldest-queued first.
  const order: TranslationEntityName[] = ["FACET", "FACET_VALUE", "CATEGORY", "MENU_ITEM", "CONTENT_PAGE", "PRODUCT"];
  for (const locale of locales) {
    for (const entity of order) {
      for (;;) {
        if (opts.signal?.aborted || Date.now() - started > sliceMs) {
          result.remaining = await queued();
          if (result.remaining) await kickTranslate(tenantId, 1);
          return result;
        }
        const rows = await db.translation.findMany({
          where: { tenantId, status: "QUEUED", locale, entity },
          orderBy: { updatedAt: "asc" },
          take: ROWS_PER_ROUND,
          select: { id: true, entityId: true, field: true, sourceHash: true },
        });
        if (!rows.length) break;
        const sources = new Map((await loadSources(tenantId, entity, { ids: [...new Set(rows.map((r) => r.entityId))] })).map((s) => [s.entityId, s.fields]));

        const work: { id: string; hash: string; text: string; markdown: boolean }[] = [];
        for (const r of rows) {
          const text = normalizeSource(sources.get(r.entityId)?.[r.field]);
          if (text === null) {
            // Entity or text gone: nothing to translate.
            await db.translation.deleteMany({ where: { id: r.id, status: "QUEUED" } });
            result.dropped++;
            continue;
          }
          const hash = sourceHash(text);
          if (hash !== r.sourceHash) {
            // Edited after queueing (the sync job may not have run yet): translate the current text.
            const moved = await db.translation.updateMany({ where: { id: r.id, status: "QUEUED", sourceHash: r.sourceHash }, data: { sourceHash: hash } });
            if (!moved.count) continue;
          }
          work.push({ id: r.id, hash, text, markdown: isMarkdownField(entity, r.field) });
        }
        if (!work.length) continue;

        const out = await translateTexts(translator, locale, work, glossaries.get(locale)!, opts.signal);
        for (let i = 0; i < work.length; i++) {
          // Only while still QUEUED for the same source: a newer edit or an approve in the meantime wins.
          const saved = await db.translation.updateMany({
            where: { id: work[i].id, status: "QUEUED", sourceHash: work[i].hash },
            data: { status: "MACHINE", value: out[i].text, stale: false },
          });
          if (saved.count) result.translated++;
          result.missingTokens += out[i].missing;
        }
      }
    }
  }
  result.remaining = await queued();
  return result;
}
