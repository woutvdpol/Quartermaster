import "server-only";
import { db } from "@/server/db";
import { getShopDictionary } from "./dictionary";
import { TtlLru } from "./lru";
import { buildVocabulary, didYouMean } from "./spelling";

/*
 * Help for searches that found nothing (results page zero state): a "Did you mean …?" correction
 * built from the shop's own vocabulary — words of product titles (every visible-or-sold product, with
 * their frequency) plus the facet value names and synonyms of the parser dictionary.
 *
 * The vocabulary is cached per tenant and process for 10 minutes; it is only built when a search
 * comes back empty. Draft/archived/stolen titles never contribute (a correction must not reveal them).
 */

const VOCAB_TTL_MS = 10 * 60 * 1000;
const VOCAB_WORDS = 20_000;
const vocabCache = new TtlLru<Promise<Map<string, number>>>(200, VOCAB_TTL_MS);

async function shopVocabulary(tenantId: string, currency: string): Promise<Map<string, number>> {
  const hit = vocabCache.get(tenantId);
  if (hit) return hit;
  const p = (async () => {
    const [rows, dict] = await Promise.all([
      db.$queryRaw<{ w: string; n: number }[]>`
        SELECT w, count(*)::int AS n
        FROM products p, regexp_split_to_table(lower(p.title), '[^[:alnum:]]+') AS w
        WHERE p."tenantId" = ${tenantId} AND p.status IN ('ACTIVE', 'RESERVED', 'SOLD') AND length(w) >= 3
        GROUP BY w ORDER BY n DESC, w LIMIT ${VOCAB_WORDS}`,
      getShopDictionary(tenantId, currency),
    ]);
    const phrases = [...dict.prepared.dict.keys()];
    return buildVocabulary(
      rows.map((r) => [r.w, r.n] as [string, number]),
      phrases,
    );
  })();
  p.catch(() => vocabCache.delete(tenantId));
  vocabCache.set(tenantId, p);
  return p;
}

export type SearchHints = {
  /** The query with misspelled words replaced by the closest word the shop knows, or null. */
  didYouMean: string | null;
};

export async function searchHints(tenantId: string, q: string, opts: { currency?: string } = {}): Promise<SearchHints> {
  const vocab = await shopVocabulary(tenantId, opts.currency ?? "EUR");
  return { didYouMean: didYouMean(q, vocab) };
}

/** Tests: forget cached vocabularies. */
export function clearSearchHintsCache(): void {
  vocabCache.clear();
}
