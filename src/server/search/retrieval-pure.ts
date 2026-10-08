import { fold } from "./normalize";
import type { ParsedQuery } from "./parser";

/* Pure query building for the lexical retriever (./retrieval.ts); unit-tested. */

/** Lexemes for tsquery: letters/digits only (no tsquery operators can sneak in). */
function words(phrase: string): string[] {
  return fold(phrase)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * One word/phrase as tsquery. Prefix match for words (helm → helmet, helmen); exact for numbers and
 * 1–2 letter words. `titleOnly` restricts to weight A (title, SKU): synonyms must not match the
 * boilerplate of descriptions ("see photos" for the synonym "photo").
 */
function lexemeQuery(phrase: string, titleOnly = false): string | null {
  const ws = words(phrase);
  if (!ws.length) return null;
  const w8 = titleOnly ? "A" : "";
  const one = (w: string) => (/^\d+$/.test(w) || w.length < 3 ? (w8 ? `${w}:${w8}` : w) : `${w}:*${w8}`);
  return ws.length === 1 ? one(ws[0]) : `(${ws.map(one).join(" <-> ")})`;
}

/**
 * tsquery strings for a parsed query: `any` term or synonym (recall), `all` terms (bonus) and
 * `typed` = only the words as typed (synonyms rank below the real word). Null without terms.
 */
export function buildTsQueries(q: Pick<ParsedQuery, "terms" | "expansions">): { any: string; all: string; typed: string } | null {
  const groups: string[] = [];
  for (const term of q.terms) {
    const alts = [lexemeQuery(term), ...(q.expansions[term] ?? []).map((e) => lexemeQuery(e, true))].filter((x): x is string => !!x);
    if (alts.length) groups.push(alts.length === 1 ? alts[0] : `(${[...new Set(alts)].join(" | ")})`);
  }
  if (!groups.length) return null;
  // Multi-word synonym phrases ("ijzeren kruis" → iron cross) only widen recall.
  const phraseAlts = Object.entries(q.expansions)
    .filter(([k]) => k.includes(" "))
    .flatMap(([, alts]) => alts.map((a) => lexemeQuery(a, true)))
    .filter((x): x is string => !!x);
  const typed = q.terms.map((t) => lexemeQuery(t)).filter((x): x is string => !!x);
  return { any: [...groups, ...phraseAlts].join(" | "), all: groups.join(" & "), typed: typed.join(" | ") || groups.join(" | ") };
}

/** Terms worth a typo-tolerant trigram comparison with the title (≥ 4 letters, not numbers). */
export function trigramTerms(q: Pick<ParsedQuery, "terms">): string[] {
  return q.terms.filter((t) => t.length >= 4 && !/^\d+$/.test(t)).slice(0, 4);
}

