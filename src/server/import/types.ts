/** Shared types of the product import (pure; no server-only so parsers stay unit-testable). */

export const IMPORT_SOURCES = ["WOOCOMMERCE", "SHOPIFY"] as const;
export type ImportSourceName = (typeof IMPORT_SOURCES)[number];

export type ImportOptions = {
  /** Publish (ACTIVE) the items that were published in the source shop; otherwise everything is a draft. */
  publish: boolean;
  /** Source tags → existing facet values matched by name (rest become plain tags), or all plain tags. */
  tagsAs: "facets" | "tags";
  /** Stock > 1: "split" into N unique items, or "single" (one item, warning). */
  stockMode: "split" | "single";
  /** Download product photos after the products are created. */
  images: boolean;
};

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { publish: false, tagsAs: "facets", stockMode: "split", images: true };

export type RowMessage = { row: number; message: string };

/**
 * One product as read from the source file, before mapping to our model. Text fields are raw
 * (HTML descriptions, price strings) — mapping.ts converts them.
 */
export type SourceProduct = {
  /** Stable id in the source shop (Woo ID / SKU / row, Shopify Handle) — idempotency key. */
  sourceId: string;
  /** Spreadsheet row of the (first) record of this product. */
  row: number;
  title: string;
  descriptionHtml: string;
  shortDescriptionHtml: string;
  sku: string | null;
  /** Visible in the source shop. */
  published: boolean;
  /** Price strings as exported ("1234.50"). */
  regularPrice: string;
  salePrice: string;
  costPrice: string;
  /** Category paths, e.g. [["Helmets", "German"], ["Uniforms"]]. */
  categories: string[][];
  tags: string[];
  /** Image URLs in display order (first = cover). */
  images: string[];
  /** Units in stock; null = not tracked (→ 1). */
  stock: number | null;
  weightGrams: number | null;
  seoTitle: string;
  seoDescription: string;
  /** Number of variants / variations folded into this product (0 = simple product). */
  variants: number;
  /** Always import as draft (variable product, …) regardless of the publish option. */
  needsReview: boolean;
  /** Row-level notes from the parser (variants, odd values). */
  warnings: string[];
};

export type ParsedSource = {
  products: SourceProduct[];
  /** Rows not imported, with the reason. */
  skipped: RowMessage[];
  /** File-level problems (missing optional columns, …). */
  notes: string[];
  /** CSV columns that were recognised → our field (for the mapping table). */
  columns: { column: string; becomes: string }[];
  /** Columns present in the file that are ignored. */
  ignoredColumns: string[];
  rows: number;
};

export class ImportFormatError extends Error {}

// ─── Views (shared with the admin UI) ─────────────────────────────────────────

export type ImportJobStatusName = "UPLOADED" | "RUNNING" | "IMAGES" | "DONE" | "FAILED" | "CANCELED";

export type ImportPreview = {
  rows: number;
  delimiter: string;
  /** Importable source products. */
  products: number;
  itemsIfSplit: number;
  itemsIfSingle: number;
  /** Products with stock > 1. */
  multiStock: number;
  /** Products published in the source shop that can go live right away. */
  publishable: number;
  images: number;
  categories: { total: number; existing: number; new: number; sample: string[] };
  tags: {
    total: number;
    /** Tags that match an existing facet value (used when tagsAs = "facets"). */
    facetMatched: { tag: string; facet: string; value: string }[];
    facetMatchedCount: number;
    unmatchedSample: string[];
  };
  skipped: RowMessage[];
  skippedCount: number;
  warnings: RowMessage[];
  warningCount: number;
  /** Rows that need attention (skipped + rows with warnings). */
  attention: number;
  notes: string[];
  columns: { column: string; becomes: string; example: string }[];
  ignoredColumns: string[];
  sample: { row: number; title: string; price: number; onSale: boolean; category: string | null; tags: string[]; images: number; stock: number | null }[];
  /** SKUs already used by other products (they are imported without SKU). */
  skuConflicts: number;
};

export type ImportProgress = {
  phase: "products" | "images" | "done";
  /** Source products processed (cursor). */
  processed: number;
  products: number;
  /** Items created by this job so far. */
  created: number;
  /** Items that existed already (re-run) — not created again. */
  existing: number;
  failed: number;
  published: number;
  imagesTotal: number;
  imagesDone: number;
  imagesFailed: number;
};

export type ImportFailure = { row: number; title: string; reason: string };

export type ImportJobView = {
  id: string;
  source: ImportSourceName;
  status: ImportJobStatusName;
  fileName: string;
  options: ImportOptions;
  preview: ImportPreview | null;
  progress: ImportProgress | null;
  failures: ImportFailure[];
  imageFailures: ImportFailure[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/** Response of POST /admin/inventory/import/upload. */
export type ImportUploadResponse = { ok: true; job: ImportJobView } | { ok: false; message: string };

/** Largest accepted export file. */
export const MAX_IMPORT_FILE_MB = 20;
