import "server-only";
import { db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import { toVectorLiteral } from "./embedder";
import { buildTsQueries, trigramTerms } from "./retrieval-pure";
import type { ParsedQuery } from "./parser";

/*
 * The three retrievers + exact matches. Every query gets `where` = the catalog's own WHERE clause
 * (src/server/storefront-catalog/queries.ts whereSql with q = null): tenant, visibility (for sale /
 * reserved, or sold for the archive), country compliance hiding, facet/tag/price filters and
 * category scope — so search can never show what the catalog would not.
 *
 *   lexical   full-text (searchVector, qm_search = simple + unaccent, prefix terms + synonym groups)
 *             OR trigram word similarity on the title (typos: "stahlhem" → Stahlhelm), ranked by
 *             ts_rank_cd + "all terms present" bonus + best trigram similarity
 *   semantic  e5 query vector vs text embeddings (HNSW, cosine)
 *   photo     SigLIP vector (from a text query or an uploaded photo) vs image embeddings
 */

export type { ScoredId } from "./ranking";
export { buildTsQueries, trigramTerms } from "./retrieval-pure";
import type { ScoredId } from "./ranking";

/** Below this many full-text hits the typo-tolerant trigram pass runs as well. */
export const TRIGRAM_FALLBACK_BELOW = 10;

/**
 * Full-text first; trigram word similarity on the title only as a fallback when full-text finds
 * little (typos: "stahlhem" → Stahlhelm). Doing both at once (an OR across the two GIN indexes) costs
 * a word_similarity() recheck on every trigram candidate: 150 ms instead of 5–20 ms on a 50k-item
 * shop for a common word like "helm" (docs/search.md § Prestaties).
 */
/**
 * Ranking (ts_rank of every matching row) is the expensive part: "jas" matches ~6,000 jackets in the
 * 50k-item benchmark shop (≈ 100 ms to rank all). Matches are therefore collected first (cheap, GIN
 * index) and at most `rankCap` of them are ranked — beyond that the order among equally matching
 * items is not meaningful anyway, and the semantic list re-orders the fused result.
 */
export const LEXICAL_RANK_CAP = 1500;

export async function lexicalSearch(where: Prisma.Sql, q: Pick<ParsedQuery, "terms" | "expansions">, limit = 200, rankCap = LEXICAL_RANK_CAP): Promise<ScoredId[]> {
  const ts = buildTsQueries(q);
  if (!ts) return [];
  const rows = await db.$queryRaw<{ id: string; score: number }[]>`
    WITH q AS (SELECT to_tsquery('qm_search', ${ts.any}) AS anyq, to_tsquery('qm_search', ${ts.all}) AS allq, to_tsquery('qm_search', ${ts.typed}) AS typedq),
    m AS (
      SELECT p.id, p."searchVector" AS v FROM products p, q
      WHERE ${where} AND p."searchVector" @@ q.anyq
      LIMIT ${rankCap}
    )
    SELECT m.id,
      (2 * ts_rank(m.v, q.typedq, 32)
        + ts_rank(m.v, q.anyq, 32)
        + CASE WHEN m.v @@ q.allq THEN 1 ELSE 0 END)::float8 AS score
    FROM m, q
    ORDER BY score DESC, m.id
    LIMIT ${limit}`;
  const tri = trigramTerms(q);
  if (rows.length >= TRIGRAM_FALLBACK_BELOW || !tri.length) return rows;
  const seen = new Set(rows.map((r) => r.id));
  const fuzzy = await db.$queryRaw<{ id: string; score: number }[]>`
    SELECT p.id, (0.6 * GREATEST(${Prisma.join(tri.map((t) => Prisma.sql`word_similarity(${t}, p.title)`), ", ")}))::float8 AS score
    FROM products p
    WHERE ${where} AND (${Prisma.join(tri.map((t) => Prisma.sql`${t} <% p.title`), " OR ")})
    ORDER BY score DESC, p.id
    LIMIT ${limit}`;
  // `fuzzy` marks typo-tolerant hits (the UI says "close spelling" for those).
  return [...rows, ...fuzzy.filter((r) => !seen.has(r.id)).map((r) => ({ ...r, fuzzy: true as const }))].slice(0, limit);
}

/** Exact stock number / SKU hits (pinned to the top of the results). */
export async function exactMatches(where: Prisma.Sql, q: Pick<ParsedQuery, "stockCode" | "terms" | "original">): Promise<string[]> {
  const ors: Prisma.Sql[] = [];
  if (q.stockCode !== null) ors.push(Prisma.sql`p."stockCode" = ${q.stockCode}`);
  const raw = q.original.trim();
  if (raw && raw.length <= 64 && !raw.includes(" ")) ors.push(Prisma.sql`lower(p.sku) = ${raw.toLowerCase()}`);
  if (!ors.length) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM products p WHERE ${where} AND (${Prisma.join(ors, " OR ")}) ORDER BY p."stockCode" LIMIT 5`;
  return rows.map((r) => r.id);
}

/**
 * Nearest products by embedding. HNSW with iterative scans (pgvector ≥ 0.8) so tenant/visibility
 * filters do not starve the result; the planner may also pick an exact scan for small tenants.
 * `kind`/`dim` select the partial index (`embedding::vector(384)` text, `::vector(768)` image).
 */
export async function vectorSearch(
  tenantId: string,
  where: Prisma.Sql,
  vector: number[],
  opts: { kind: "text" | "image"; dim: number; limit?: number; minSimilarity?: number; excludeId?: string },
): Promise<ScoredId[]> {
  if (vector.length !== opts.dim) throw new Error(`vector has ${vector.length} dimensions, expected ${opts.dim}`);
  const limit = opts.limit ?? 100;
  const lit = toVectorLiteral(vector);
  // The cast must match the index expression exactly; dim is one of two constants (never user input).
  const castType = Prisma.raw(opts.dim === 384 ? "vector(384)" : opts.dim === 768 ? "vector(768)" : "vector");
  const distance = Prisma.sql`(e.embedding::${castType} <=> ${lit}::${castType})`;
  const exclude = opts.excludeId ? Prisma.sql`AND p.id <> ${opts.excludeId}` : Prisma.empty;
  const [, , rows] = await db.$transaction([
    db.$executeRaw`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`,
    db.$executeRaw`SELECT set_config('hnsw.ef_search', ${String(Math.max(40, Math.min(400, limit * 2)))}, true)`,
    db.$queryRaw<{ id: string; distance: number }[]>`
      SELECT e."productId" AS id, ${distance}::float8 AS distance
      FROM product_embeddings e
      JOIN products p ON p.id = e."productId"
      WHERE e."tenantId" = ${tenantId} AND e.kind = ${opts.kind}::embedding_kind AND ${where} ${exclude}
      ORDER BY ${distance}
      LIMIT ${limit}`,
  ]);
  // relaxed_order may return slightly out of order: sort, then convert distance → similarity.
  return rows
    .map((r) => ({ id: r.id, score: 1 - r.distance }))
    .sort((a, b) => b.score - a.score)
    .filter((r) => opts.minSimilarity === undefined || r.score >= opts.minSimilarity);
}

/** Stored vectors of one product (similar products). */
export async function productVectors(tenantId: string, productId: string): Promise<{ text: number[] | null; image: number[] | null }> {
  const rows = await db.$queryRaw<{ kind: "text" | "image"; v: string }[]>`
    SELECT kind::text AS kind, embedding::text AS v FROM product_embeddings WHERE "tenantId" = ${tenantId} AND "productId" = ${productId}`;
  const parse = (s: string | undefined) => (s ? (JSON.parse(s) as number[]) : null);
  return { text: parse(rows.find((r) => r.kind === "text")?.v), image: parse(rows.find((r) => r.kind === "image")?.v) };
}

/** Orders a set of ids by a catalog sort (non-relevance sorts of search results). */
export async function orderIds(ids: string[], order: Prisma.Sql): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT p.id FROM products p WHERE p.id = ANY(${ids}::text[]) ORDER BY ${order}`;
  return rows.map((r) => r.id);
}
