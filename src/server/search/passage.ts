import { createHash } from "node:crypto";

/*
 * What gets embedded per product (pure, unit-tested). The text passage carries everything a buyer
 * might describe — title, category path, facet values (with facet names), tags, SKU, specifications
 * and the start of the description (Markdown stripped). e5-small reads at most 512 tokens; the
 * passage is capped well below that so the title/facets always fit.
 */

export type PassageInput = {
  title: string;
  sku: string | null;
  description: string | null;
  categoryPath: string[];
  /** "Country: Germany", "Period: WW2" … */
  facets: { facet: string; value: string }[];
  tags: string[];
  specifications: { label: string; value: string }[];
};

const MAX_DESCRIPTION = 1200;

/** Markdown → plain text (good enough for embedding: links keep their label, markup goes). */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPassage(p: PassageInput): string {
  const parts: string[] = [p.title.trim()];
  if (p.categoryPath.length) parts.push(`Category: ${p.categoryPath.join(" › ")}`);
  const byFacet = new Map<string, string[]>();
  for (const f of p.facets) byFacet.set(f.facet, [...(byFacet.get(f.facet) ?? []), f.value]);
  for (const [facet, values] of byFacet) parts.push(`${facet}: ${values.join(", ")}`);
  if (p.tags.length) parts.push(`Tags: ${p.tags.join(", ")}`);
  if (p.sku) parts.push(`SKU ${p.sku}`);
  for (const s of p.specifications.slice(0, 12)) parts.push(`${s.label}: ${s.value}`);
  if (p.description) {
    const d = stripMarkdown(p.description);
    parts.push(d.length > MAX_DESCRIPTION ? `${d.slice(0, MAX_DESCRIPTION).replace(/\s+\S*$/, "")}…` : d);
  }
  return parts.filter(Boolean).join(". ").replace(/\.\./g, ".");
}

/** Hash of what was embedded and with which model: unchanged hash → no re-embedding. */
export function contentHash(model: string, input: string): string {
  return createHash("sha256").update(model).update("\u0000").update(input).digest("hex");
}
