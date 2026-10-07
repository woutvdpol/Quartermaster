/*
 * Admin form description per block type, mirroring BLOCK_SCHEMAS in `@/server/content/blocks`.
 * Pure (client-safe). The schemas stay the source of truth for validation: the editor validates
 * drafts with `BLOCK_SCHEMAS[type].safeParse` and the service validates again on save.
 */
import { BLOCK_DEFAULTS, BLOCK_SCHEMAS, type BlockIssue, type ContentBlockType } from "@/server/content/blocks";

export type FieldSpec =
  | { key: string; kind: "text"; label: string; max: number; required?: boolean; hint?: string }
  | { key: string; kind: "textarea"; label: string; max: number; required?: boolean; rows?: number }
  | { key: string; kind: "markdown"; label: string }
  | { key: string; kind: "url"; label: string; required?: boolean }
  | { key: string; kind: "link"; label: string; toggle: string }
  | { key: string; kind: "image"; label: string }
  | { key: string; kind: "images"; label: string; max: number }
  | { key: string; kind: "position"; label: string }
  | { key: string; kind: "product"; label: string }
  | { key: string; kind: "categories"; label: string; max: number }
  | { key: string; kind: "count"; label: string; min: number; max: number };

const title = (required = false): FieldSpec => ({ key: "title", kind: "text", label: "Title", max: 100, required });
const markdown: FieldSpec = { key: "markdown", kind: "markdown", label: "Text" };
const cta: FieldSpec = { key: "cta", kind: "link", label: "Button", toggle: "Show a button" };

export const BLOCK_FIELDS: Record<ContentBlockType, FieldSpec[]> = {
  HERO: [
    title(true),
    { key: "subtitle", kind: "textarea", label: "Subtitle", max: 300, rows: 2 },
    { key: "imageKey", kind: "image", label: "Background image" },
    cta,
  ],
  TEXT: [title(), markdown, cta],
  TEXT_HORIZONTAL: [title(), markdown],
  TEXT_IMAGE: [title(), markdown, { key: "imageKey", kind: "image", label: "Image" }, { key: "imagePosition", kind: "position", label: "Image position" }, cta],
  TEXT_PRODUCT: [title(), markdown, { key: "productId", kind: "product", label: "Product" }],
  TEXT_CAROUSEL: [title(), markdown, { key: "imageKeys", kind: "images", label: "Carousel images", max: 20 }],
  QUOTE: [
    { key: "quote", kind: "textarea", label: "Quote", max: 500, required: true, rows: 3 },
    { key: "author", kind: "text", label: "Author", max: 100 },
  ],
  CTA: [
    title(true),
    { key: "text", kind: "textarea", label: "Text", max: 200, rows: 2 },
    { key: "buttonLabel", kind: "text", label: "Button label", max: 50, required: true },
    { key: "href", kind: "url", label: "Button link", required: true },
    { key: "imageKey", kind: "image", label: "Background image" },
  ],
  GALLERY: [title(), { key: "imageKeys", kind: "images", label: "Images", max: 60 }],
  TESTIMONIAL: [
    { key: "quote", kind: "textarea", label: "Review", max: 1000, required: true, rows: 4 },
    { key: "author", kind: "text", label: "Author", max: 100, required: true },
    { key: "link", kind: "link", label: "Link", toggle: "Add a link (e.g. to the review)" },
  ],
  CATEGORIES: [title(), { key: "categoryIds", kind: "categories", label: "Categories", max: 24 }],
  NEW_ITEMS: [title(), { key: "count", kind: "count", label: "Number of items", min: 1, max: 24 }, cta],
  NEWSLETTER_SIGNUP: [title(true), { key: "text", kind: "textarea", label: "Text", max: 500, rows: 3 }],
};

export type BlockDraft = Record<string, unknown>;

/** Empty value of the same kind as a default value, for fields missing from legacy data. */
function emptyLike(def: unknown): unknown {
  if (typeof def === "string") return "";
  if (Array.isArray(def)) return [];
  if (typeof def === "number") return def;
  return null;
}

/**
 * Turns stored block data (valid or legacy/invalid) into a complete form draft: every field present
 * with the right shape. Known keys keep their stored value; missing ones become empty.
 */
export function toDraft(type: ContentBlockType, data: unknown): BlockDraft {
  const raw = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const defaults = BLOCK_DEFAULTS[type] as unknown as Record<string, unknown>;
  const out: BlockDraft = {};
  for (const [key, def] of Object.entries(defaults)) {
    const v = raw[key];
    if (v === undefined) out[key] = key === "imagePosition" ? def : emptyLike(def);
    else if (typeof def === "string" && typeof v !== "string") out[key] = v == null ? "" : String(v);
    else out[key] = v;
  }
  return out;
}

export type DraftCheck = { ok: true; data: BlockDraft } | { ok: false; issues: BlockIssue[] };

/** Client-side validation with the block's schema (same rules as the service). */
export function checkDraft(type: ContentBlockType, draft: BlockDraft): DraftCheck {
  const res = BLOCK_SCHEMAS[type].safeParse(draft);
  if (res.success) return { ok: true, data: res.data as BlockDraft };
  return { ok: false, issues: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** Issues for a field key (including nested paths like `cta.href`), as a key → messages map. */
export function issuesByPath(issues: readonly BlockIssue[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of issues) (out[i.path || "_form"] ??= []).push(i.message);
  return out;
}

export function issuesFor(map: Record<string, string[]>, path: string): string[] | undefined {
  const exact = map[path];
  const nested = Object.entries(map)
    .filter(([k]) => k.startsWith(`${path}.`) && !k.slice(path.length + 1).match(/^(label|href)$/))
    .flatMap(([, v]) => v);
  const all = [...(exact ?? []), ...nested];
  return all.length ? all : undefined;
}

// ─── Image URLs ──────────────────────────────────────────────────────────────

/**
 * Public URL for a storage key, using the variant convention of the media service
 * (`{key without ext}/{variant}.webp`, see `variantKey` in `@/server/media/product-images`, which is
 * server-only). Content uploads from this screen follow the same layout.
 */
export function storageImageUrl(key: string, variant: "thumb" | "card" | "large" | "original" = "card"): string {
  if (variant === "original") return `/uploads/${key}`;
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  const base = dot > slash ? key.slice(0, dot) : key;
  return `/uploads/${base}/${variant}.webp`;
}
