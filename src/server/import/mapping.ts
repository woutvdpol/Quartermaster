/**
 * SourceProduct → what we create (PlannedProduct). Pure: lookups that need the database (facet
 * values by name) are passed in.
 *
 * Rules (docs/import.md):
 *  - Every item is unique (stock 1). Stock > 1 → "split" into N items (capped at MAX_SPLIT_UNITS) or
 *    "single" (one item, warning). Stock 0 / out of stock → one draft item without stock.
 *  - Price = what the customer pays: the sale price when there is one (onSale = true), else the
 *    regular price. The regular price is kept in Product.legacyData for reference.
 *  - Descriptions: HTML → our Markdown subset (never raw HTML); short description first.
 *  - Status: DRAFT unless `publish` is on AND the item was published in the source AND it is
 *    publishable (price > 0, in stock, not flagged for review).
 */
import { parseMoney } from "@/components/admin/ui/money-utils";
import { htmlToMarkdown, htmlToPlainText } from "@/server/content/html-markdown";
import type { ImportOptions, RowMessage, SourceProduct } from "./types";

export const MAX_SPLIT_UNITS = 50;
export const MAX_IMAGES_PER_SOURCE = 30;
export const MAX_TAGS_PER_PRODUCT = 50;
const MAX_URL_LENGTH = 2048;

export type FacetMatch = { valueId: string; facet: string; value: string };
export type FacetMatcher = (tag: string) => FacetMatch | null;

export type PlannedProduct = {
  sourceId: string;
  row: number;
  title: string;
  description: string | null;
  sku: string | null;
  /** Minor units. */
  price: number;
  regularPrice: number | null;
  onSale: boolean;
  purchasePrice: number | null;
  weightGrams: number;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Category titles from root to leaf, or null. */
  categoryPath: string[] | null;
  /** Plain tag names. */
  tags: string[];
  /** Matched facet values. */
  facets: FacetMatch[];
  images: string[];
  /** Items to create (split) — each with `quantity`. */
  units: number;
  quantity: 0 | 1;
  status: "DRAFT" | "ACTIVE";
  warnings: string[];
};

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() : s);

/**
 * Parses an exported price into minor units. Exports use a decimal point without grouping
 * ("1234.50"); spreadsheet re-saves may use "1.234,50" / "12,50" (handled by parseMoney).
 * Returns null for empty / invalid / negative values.
 */
export function parsePriceMinor(raw: string, digits = 2): number | null {
  const s = raw.trim();
  if (!s) return null;
  const plain = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (plain) {
    const frac = (plain[2] ?? "").padEnd(digits + 1, "0");
    let minor = Number(plain[1] + frac.slice(0, digits));
    if (Number(frac[digits]) >= 5) minor += 1; // round half up on the first dropped digit
    return Number.isSafeInteger(minor) ? minor : null;
  }
  const parsed = parseMoney(s, digits);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

export function isHttpUrl(u: string): boolean {
  if (u.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Source description HTML → Markdown (short description first). Images in the text are dropped. */
export function descriptionMarkdown(p: Pick<SourceProduct, "descriptionHtml" | "shortDescriptionHtml">): string | null {
  const short = htmlToMarkdown(p.shortDescriptionHtml, (h) => h, { images: "drop" });
  const long = htmlToMarkdown(p.descriptionHtml, (h) => h, { images: "drop" });
  const text = [short, long].filter(Boolean).join("\n\n");
  return text ? clip(text, 100_000) : null;
}

export function planProduct(p: SourceProduct, options: ImportOptions, ctx: { digits: number; matchFacet?: FacetMatcher }): PlannedProduct {
  const warnings = [...p.warnings];
  const regular = parsePriceMinor(p.regularPrice, ctx.digits);
  const sale = parsePriceMinor(p.salePrice, ctx.digits);
  if (p.regularPrice && regular === null) warnings.push(`Price “${p.regularPrice}” is not a valid amount.`);
  if (p.salePrice && sale === null) warnings.push(`Sale price “${p.salePrice}” is not a valid amount.`);
  const onSale = sale !== null && (regular === null || sale < regular);
  const price = onSale ? sale! : (regular ?? sale ?? 0);
  if (price === 0) warnings.push("No price — imported as draft.");
  const cost = parsePriceMinor(p.costPrice, ctx.digits);

  // Stock → units.
  let units = 1;
  let quantity: 0 | 1 = 1;
  if (p.stock !== null && p.stock <= 0) {
    quantity = 0;
    warnings.push("Out of stock — imported as a draft without stock.");
  } else if (p.stock !== null && p.stock > 1 && p.variants > 0) {
    // Stock of the first variant only — the item needs review anyway, so never split it.
  } else if (p.stock !== null && p.stock > 1) {
    if (options.stockMode === "split") {
      units = Math.min(p.stock, MAX_SPLIT_UNITS);
      warnings.push(
        p.stock > MAX_SPLIT_UNITS
          ? `Stock ${p.stock}: split into ${MAX_SPLIT_UNITS} items (maximum) — check the rest by hand.`
          : `Stock ${p.stock}: split into ${p.stock} unique items.`,
      );
    } else {
      warnings.push(`Stock ${p.stock}: imported as one unique item.`);
    }
  }

  // Tags → facet values or plain tags.
  const facets: FacetMatch[] = [];
  const tags: string[] = [];
  const seenTags = new Set<string>();
  for (const raw of p.tags) {
    const tag = clip(raw.trim(), 100);
    const key = tag.toLowerCase();
    if (!tag || seenTags.has(key)) continue;
    seenTags.add(key);
    const match = options.tagsAs === "facets" && ctx.matchFacet ? ctx.matchFacet(tag) : null;
    if (match) {
      if (!facets.some((f) => f.valueId === match.valueId)) facets.push(match);
    } else tags.push(tag);
  }
  if (tags.length > MAX_TAGS_PER_PRODUCT) {
    warnings.push(`${tags.length} tags — only the first ${MAX_TAGS_PER_PRODUCT} are imported.`);
    tags.length = MAX_TAGS_PER_PRODUCT;
  }

  // Images: http(s) only.
  const images: string[] = [];
  for (const u of p.images) {
    if (!isHttpUrl(u)) warnings.push(`Photo URL ignored (not http/https): ${clip(u, 80)}`);
    else if (images.length < MAX_IMAGES_PER_SOURCE) images.push(u);
  }
  if (p.images.length > MAX_IMAGES_PER_SOURCE) warnings.push(`More than ${MAX_IMAGES_PER_SOURCE} photos — the rest is skipped.`);

  const category = p.categories[0]?.map((t) => clip(t, 100)).filter(Boolean) ?? [];
  const publishable = price > 0 && quantity > 0 && !p.needsReview;
  const status = options.publish && p.published && publishable ? "ACTIVE" : "DRAFT";
  if (options.publish && p.published && !publishable && p.needsReview) warnings.push("Needs review — imported as draft.");

  return {
    sourceId: p.sourceId,
    row: p.row,
    title: clip(p.title.replace(/\s+/g, " ").trim(), 300),
    description: descriptionMarkdown(p),
    sku: p.sku ? clip(p.sku, 100) : null,
    price,
    regularPrice: regular,
    onSale,
    purchasePrice: cost,
    weightGrams: Math.min(Math.max(0, p.weightGrams ?? 0), 10_000_000),
    seoTitle: p.seoTitle ? clip(htmlToPlainText(p.seoTitle), 200) || null : null,
    seoDescription: p.seoDescription ? clip(htmlToPlainText(p.seoDescription), 500) || null : null,
    categoryPath: category.length ? category : null,
    tags,
    facets,
    images,
    units,
    quantity,
    status,
    warnings,
  };
}

/** Category path key (case-insensitive) used to match existing categories. */
export function categoryKey(path: string[]): string {
  return path.map((t) => t.trim().toLowerCase()).join(" › ");
}

export type PlanSummary = {
  products: number;
  /** Items created with the chosen stock mode. */
  items: number;
  itemsIfSplit: number;
  itemsIfSingle: number;
  multiStock: number;
  publish: number;
  images: number;
  categoryPaths: string[][];
  tags: string[];
  facetMatches: FacetMatch[];
  warnings: RowMessage[];
};

/** Aggregates a plan for the preview. */
export function summarisePlans(plans: PlannedProduct[], sources: SourceProduct[]): PlanSummary {
  const paths = new Map<string, string[]>();
  const tags = new Map<string, string>();
  const facets = new Map<string, FacetMatch>();
  let items = 0;
  let itemsIfSplit = 0;
  let multiStock = 0;
  let publish = 0;
  let images = 0;
  const warnings: RowMessage[] = [];
  for (const [i, p] of plans.entries()) {
    const stock = sources[i]?.variants ? null : (sources[i]?.stock ?? null);
    items += p.units;
    itemsIfSplit += stock !== null && stock > 1 ? Math.min(stock, MAX_SPLIT_UNITS) : 1;
    if (stock !== null && stock > 1) multiStock++;
    if (p.status === "ACTIVE") publish += p.units;
    images += p.images.length;
    if (p.categoryPath) {
      // Every prefix is a category of its own.
      for (let n = 1; n <= p.categoryPath.length; n++) {
        const prefix = p.categoryPath.slice(0, n);
        paths.set(categoryKey(prefix), prefix);
      }
    }
    for (const t of p.tags) if (!tags.has(t.toLowerCase())) tags.set(t.toLowerCase(), t);
    for (const f of p.facets) facets.set(f.valueId, f);
    for (const w of p.warnings) warnings.push({ row: p.row, message: w });
  }
  return {
    products: plans.length,
    items,
    itemsIfSplit,
    itemsIfSingle: plans.length,
    multiStock,
    publish,
    images,
    categoryPaths: [...paths.values()],
    tags: [...tags.values()],
    facetMatches: [...facets.values()],
    warnings,
  };
}
