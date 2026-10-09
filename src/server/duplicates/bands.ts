import type { ProductStatus } from "@/generated/prisma/enums";

/*
 * Duplicate photo check — pure parts (docs/duplicate-check.md): similarity bands and candidate
 * selection. Scores are cosine similarities between SigLIP 2 photo vectors (the same vectors as
 * photo search, src/server/search).
 *
 * Calibration (demo shop, real SigLIP 2 model, 227 photos of 93 products; method in the doc):
 *   same photo uploaded again          ≥ 0.988 (all 90)
 *   another photo of the same product  0.941 – 0.991, median 0.977; 78 % ≥ 0.97, 11 % ≥ 0.985
 *   best other product, same category  0.854 – 0.990, median 0.955; 31 % ≥ 0.97,  7 % ≥ 0.985
 * The demo photos are drawings in one uniform style, so everything sits high and close together;
 * real photos of different pieces spread out more. The thresholds lean towards "rather nothing
 * than noise": "close" keeps most other photos of the same piece while most look-alikes in the
 * same category fall below it; "very close" is (almost) only the same photo or the same shot.
 */

/** At or above: "Very close match" (same photo, or the same piece shot the same way). */
export const VERY_CLOSE = 0.985;
/** At or above: "Close match". Below this a product is never shown. */
export const CLOSE = 0.97;
/** Candidates must be within this distance of the best one (drops the tail of look-alikes). */
export const MARGIN = 0.015;
/** At most this many candidates are shown. */
export const MAX_CANDIDATES = 3;

export type SimilarityBand = "very_close" | "close";

export function bandFor(score: number): SimilarityBand | null {
  if (!Number.isFinite(score)) return null;
  if (score >= VERY_CLOSE) return "very_close";
  if (score >= CLOSE) return "close";
  return null;
}

/** One kNN hit: a product of some tenant and its similarity to one uploaded photo. */
export type DuplicateHit = { productId: string; tenantId: string; status: ProductStatus; score: number };

export type SelectedCandidate = { productId: string; status: ProductStatus; score: number; band: SimilarityBand };

/**
 * Hits of all uploaded photos → at most MAX_CANDIDATES products: only the tenant's own products
 * (defensive: the SQL is tenant-scoped already), never the product being edited, every status
 * (stock, drafts, sold archive, …). Per product the best score over the photos counts; ordered by
 * score, within MARGIN of the best, at least "close".
 */
export function selectCandidates(
  hits: readonly DuplicateHit[],
  opts: { tenantId: string; excludeProductId?: string | null; max?: number },
): SelectedCandidate[] {
  const best = new Map<string, DuplicateHit>();
  for (const h of hits) {
    if (h.tenantId !== opts.tenantId || h.productId === opts.excludeProductId) continue;
    if (!bandFor(h.score)) continue;
    const prev = best.get(h.productId);
    if (!prev || h.score > prev.score) best.set(h.productId, h);
  }
  const sorted = [...best.values()].sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
  const top = sorted[0]?.score ?? 0;
  return sorted
    .filter((h) => h.score >= top - MARGIN)
    .slice(0, opts.max ?? MAX_CANDIDATES)
    .map((h) => ({ productId: h.productId, status: h.status, score: h.score, band: bandFor(h.score)! }));
}
