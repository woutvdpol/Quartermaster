import type { PublicCategoryNode } from "@/server/storefront-catalog/types";
import { fold } from "./normalize";
import type { InterpretationChip } from "./parser";

/*
 * Small pure helpers that turn engine output into what the search UI shows (unit-tested in
 * ui-labels.test.ts): the "why" line of a dropdown item, photo-match labels, and category
 * suggestions for the typed words.
 */

export type SuggestReason = "exact" | "lexical" | "typo" | "semantic" | "filters";

/** Value part of a chip label ("Country: Germany" → "Germany"). */
const chipValue = (c: InterpretationChip) => (c.kind === "facet" ? c.label.slice(c.label.indexOf(":") + 1).trim() : c.label);

/**
 * The dropdown's "why" line: "Exact item number", "Matches: helm · Germany · WW2",
 * "Close spelling: stahlhem", "Similar in meaning: field blouse".
 */
export function suggestWhy(reason: SuggestReason, interpretation: { text: string; chips: InterpretationChip[] }, title?: string): string {
  // Trigram hits whose title contains the words anyway ("helm" in "Stahlhelm") are not typos.
  if (reason === "typo" && title && interpretation.text.trim()) {
    const t = fold(title);
    if (fold(interpretation.text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).every((w) => t.includes(w))) reason = "lexical";
  }
  const parts = [interpretation.text.trim(), ...interpretation.chips.filter((c) => c.kind === "facet" || c.kind === "price").map(chipValue)].filter(Boolean);
  switch (reason) {
    case "exact":
      return "Exact item number";
    case "typo":
      return interpretation.text.trim() ? `Close spelling: ${interpretation.text.trim()}` : "Close spelling";
    case "semantic":
      return interpretation.text.trim() ? `Similar in meaning: ${interpretation.text.trim()}` : "Similar in meaning";
    case "filters":
    case "lexical":
      return parts.length ? `Matches: ${parts.join(" · ")}` : "Matches your search";
  }
}

export type MatchLevel = "very_close" | "close" | "similar";

/**
 * Photo-search label from the SigLIP image↔image cosine (docs/search.md § Ranking: the same kind of
 * object ≈ 0.93–0.99, other objects shot the same way 0.85–0.9).
 */
export function matchLevel(score: number | null | undefined): MatchLevel | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score >= 0.93) return "very_close";
  if (score >= 0.88) return "close";
  return "similar";
}

export const MATCH_LABELS: Record<MatchLevel, string> = { very_close: "Very close", close: "Close", similar: "Similar" };

export type CategorySuggestion = { id: string; label: string; href: string; count: number };

/**
 * Categories (with visible items) whose name contains a typed word as a word prefix (≥ 3 letters),
 * as "Parent › Child". Deepest/most specific first among equal matches, then by item count.
 */
export function matchCategories(tree: PublicCategoryNode[], q: string, hrefFor: (slug: string) => string, limit = 3): CategorySuggestion[] {
  const words = fold(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
  if (!words.length) return [];
  const out: (CategorySuggestion & { score: number; depth: number })[] = [];
  const walk = (nodes: PublicCategoryNode[], path: string[]) => {
    for (const n of nodes) {
      const names = [...path, n.title];
      const own = fold(n.title).split(/[^\p{L}\p{N}]+/u);
      const score = words.filter((w) => own.some((o) => o.startsWith(w))).length;
      if (score && n.total > 0) out.push({ id: n.id, label: names.join(" › "), href: hrefFor(n.slug), count: n.total, score, depth: names.length });
      walk(n.children, names);
    }
  };
  walk(tree, []);
  return out
    .sort((a, b) => b.score - a.score || b.count - a.count || b.depth - a.depth)
    .slice(0, limit)
    .map(({ id, label, href, count }) => ({ id, label, href, count }));
}
