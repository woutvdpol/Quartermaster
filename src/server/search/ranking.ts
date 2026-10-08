import type { ParsedQuery } from "./parser";

/*
 * Ranking rules of smart search (pure; unit-tested). See docs/search.md § Ranking.
 *
 * Thresholds are calibrated on the demo shop. Raw cosines are not comparable across queries:
 * e5-small cosines of short product texts are compressed (unrelated ≈ 0.77–0.80, related
 * 0.80–0.89) and SigLIP text→photo cosines are tiny (≈ 0.06 ± 0.005, clear matches 0.075+) and shift
 * with the query length. So a hit is judged against the other candidates of the same query
 * (z-score) as well as an absolute floor:
 *  - semantic: without lexical hits, keep what is above the floor and close to the best hit; with
 *    lexical hits, semantic-only items must stand out (z ≥ 2.5) — otherwise they only boost.
 *  - photo space: items the text retrievers found get a boost (z ≥ 0.5); other items only enter when
 *    the text retrievers found nothing at all, and then only as clear outliers (z ≥ 2.5) — SigLIP's
 *    text tower is easily fooled by typos ("stahlhem" → a medal photo).
 */

export type ScoredId = { id: string; score: number };

export const TEXT_FLOOR = 0.81;
export const TEXT_MARGIN = 0.025;
export const OUTLIER_Z = 2.5;
export const BOOST_Z = 0.5;
export const IMAGE_TEXT_FLOOR = 0.065;
export const IMAGE_TEXT_LIMIT = 48;
export const WEIGHTS = { lexical: 1, semantic: 0.9, imageText: 0.5 } as const;
/** Smaller than the classic 60: lists here are short, the top ranks should count. */
export const FUSION_K = 20;
/**
 * Photo search: SigLIP image↔image. Same kind of object ≈ 0.93–0.99, other objects photographed the
 * same way 0.85–0.9 (demo shop): keep what is close to the best match, above an absolute floor.
 */
export const IMAGE_MIN_SIMILARITY = 0.7;
export const IMAGE_MARGIN = 0.1;
/** Similar products: summed z-scores of the text and photo neighbour lists must reach this. */
export const SIMILAR_MIN_Z = 1.5;

/** z-score of every hit among the candidates of one query (0 when there is no spread). */
export function zScores(hits: readonly ScoredId[]): Map<string, number> {
  const n = hits.length;
  const mean = hits.reduce((a, h) => a + h.score, 0) / Math.max(1, n);
  const sd = Math.sqrt(hits.reduce((a, h) => a + (h.score - mean) ** 2, 0) / Math.max(1, n));
  return new Map(hits.map((h) => [h.id, sd > 1e-9 ? (h.score - mean) / sd : 0]));
}

/** Semantic hits worth keeping (see above). `hits` sorted best first. */
export function keepSemantic(hits: readonly ScoredId[], lexicalIds: ReadonlySet<string>, floor = TEXT_FLOOR, margin = TEXT_MARGIN): ScoredId[] {
  const best = hits[0]?.score ?? 0;
  const z = zScores(hits);
  const close = (h: ScoredId) => h.score >= Math.max(floor, best - margin);
  if (!lexicalIds.size) return hits.filter(close);
  return hits.filter((h) => (lexicalIds.has(h.id) && h.score >= floor) || (close(h) && (z.get(h.id) ?? 0) >= OUTLIER_Z));
}

/** Photo-space hits for a text query: boosts for text hits, clear outliers only when text found nothing. */
export function keepImageText(hits: readonly ScoredId[], textIds: ReadonlySet<string>): ScoredId[] {
  const z = zScores(hits);
  return hits.filter((h) => {
    const zi = z.get(h.id) ?? 0;
    return h.score >= IMAGE_TEXT_FLOOR && (textIds.has(h.id) ? zi >= BOOST_Z : textIds.size === 0 && zi >= OUTLIER_Z);
  });
}

/**
 * Text for the embedding models: the free text plus a few synonyms per word ("veldfles (canteen,
 * water bottle, feldflasche)"). A lone foreign word is ambiguous for a small model; its synonyms are
 * not (demo shop: the right item goes from rank > 8 to rank 1 for veldfles, kraagspiegels).
 */
export function semanticText(p: Pick<ParsedQuery, "text" | "expansions">): string {
  const extra = [...new Set(Object.values(p.expansions).flatMap((alts) => alts.slice(0, 3)))].slice(0, 9);
  return extra.length ? `${p.text} (${extra.join(", ")})` : p.text;
}
