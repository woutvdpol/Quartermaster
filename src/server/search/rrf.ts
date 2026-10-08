/*
 * Reciprocal Rank Fusion (Cormack et al. 2009): score(d) = Σ_lists weight / (k + rank_list(d)),
 * rank starting at 1. Rank-based, so lists with incomparable scores (ts_rank, cosine distances of
 * two different models) fuse without calibration. Pure.
 */

export type RankedList = {
  name: string;
  /** Ids in rank order (best first). Duplicates after the first occurrence are ignored. */
  ids: readonly string[];
  /** Default 1. */
  weight?: number;
};

export type FusedHit = {
  id: string;
  score: number;
  /** 1-based rank per list the id appeared in. */
  ranks: Record<string, number>;
};

export const RRF_K = 60;

export function rrf(lists: readonly RankedList[], opts: { k?: number; pinned?: readonly string[]; limit?: number } = {}): FusedHit[] {
  const k = opts.k ?? RRF_K;
  const byId = new Map<string, FusedHit>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    if (weight <= 0) continue;
    const seen = new Set<string>();
    let rank = 0;
    for (const id of list.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;
      const hit = byId.get(id) ?? { id, score: 0, ranks: {} };
      hit.score += weight / (k + rank);
      hit.ranks[list.name] = rank;
      byId.set(id, hit);
    }
  }
  const pinned = [...new Set(opts.pinned ?? [])];
  const pinnedSet = new Set(pinned);
  const rest = [...byId.values()].filter((h) => !pinnedSet.has(h.id)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // Pinned ids (exact stock number / SKU hits) go first, in the given order, even if no list had them.
  const head = pinned.map((id) => byId.get(id) ?? { id, score: Infinity, ranks: {} });
  const out = [...head, ...rest];
  return opts.limit ? out.slice(0, opts.limit) : out;
}
