/**
 * Content block types: one Zod schema per `ContentBlockType`, the discriminated union over them,
 * defaults for "add block" and the catalog for the admin block picker.
 *
 * Pure module (no DB, no `server-only`) so the admin editor can import schemas, defaults and the
 * catalog client-side for inline validation.
 *
 * Conventions for `ContentBlock.data`:
 *  - Rich text is a Markdown string (`markdown`), rendered by `./markdown` (safe subset, HTML escaped).
 *  - Links are `{ label, href }`; `href` passes `sanitizeUrl` (http/https/mailto/relative only).
 *  - Images are storage keys (`{tenantId}/content/…`), never URLs; the service checks the tenant prefix.
 *  - Products/categories are referenced by id; the service checks they belong to the tenant.
 *  - Optional text defaults to "" and optional objects to null, so stored data is always complete.
 *  - Legacy EMAILER is `NEWSLETTER_SIGNUP` (enum name in the schema).
 */
import { z } from "zod";
import { ContentBlockType } from "@/generated/prisma/enums";
import { MAX_MARKDOWN_LENGTH } from "./markdown";
import { MAX_URL_LENGTH, sanitizeUrl } from "./url";

export { ContentBlockType };

// ─── Field schemas ───────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max).default("");
const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);

export const safeUrlSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(MAX_URL_LENGTH)
  .transform((v, ctx) => {
    const safe = sanitizeUrl(v);
    if (!safe) {
      ctx.addIssue({ code: "custom", message: "Only http(s), mailto and relative links are allowed" });
      return z.NEVER;
    }
    return safe;
  });

// Mirrors the storage key rules in `@/server/media/storage` (kept local: that module is Node-only).
const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const imageKeySchema = z
  .string()
  .max(512)
  .refine((k) => k.length > 0 && !k.startsWith("/") && k.split("/").every((s) => KEY_SEGMENT.test(s)), "Invalid image key");

const idSchema = z.string().min(1).max(64);

export const linkSchema = z.object({ label: requiredText(50), href: safeUrlSchema });
export type BlockLink = z.output<typeof linkSchema>;

const markdown = z.string().max(MAX_MARKDOWN_LENGTH).default("");
const title = text(100);
const optionalLink = linkSchema.nullable().default(null);
const optionalImage = imageKeySchema.nullable().default(null);
const imageList = (max: number) =>
  z
    .array(imageKeySchema)
    .max(max)
    .default([])
    .refine((a) => new Set(a).size === a.length, "Duplicate image");

// ─── Per-type data ───────────────────────────────────────────────────────────

export const BLOCK_SCHEMAS = {
  HERO: z.object({ title: requiredText(100), subtitle: text(300), imageKey: optionalImage, cta: optionalLink }),
  TEXT: z.object({ title, markdown, cta: optionalLink }),
  TEXT_HORIZONTAL: z.object({ title, markdown }),
  TEXT_IMAGE: z.object({ title, markdown, imageKey: optionalImage, imagePosition: z.enum(["left", "right"]).default("left"), cta: optionalLink }),
  TEXT_PRODUCT: z.object({ title, markdown, productId: idSchema.nullable().default(null) }),
  TEXT_CAROUSEL: z.object({ title, markdown, imageKeys: imageList(20) }),
  QUOTE: z.object({ quote: requiredText(500), author: text(100) }),
  CTA: z.object({ title: requiredText(100), text: text(200), buttonLabel: requiredText(50), href: safeUrlSchema, imageKey: optionalImage }),
  GALLERY: z.object({ title, imageKeys: imageList(60) }),
  TESTIMONIAL: z.object({ quote: requiredText(1000), author: requiredText(100), link: optionalLink }),
  CATEGORIES: z.object({
    title,
    /** Empty = all active top-level categories. */
    categoryIds: z
      .array(idSchema)
      .max(24)
      .default([])
      .refine((a) => new Set(a).size === a.length, "Duplicate category"),
  }),
  NEW_ITEMS: z.object({ title, count: z.int().min(1).max(24).default(6), cta: optionalLink }),
  NEWSLETTER_SIGNUP: z.object({ title: requiredText(100), text: text(500) }),
} as const satisfies Record<ContentBlockType, z.ZodType>;

export type BlockDataMap = { [T in ContentBlockType]: z.output<(typeof BLOCK_SCHEMAS)[T]> };
export type BlockData<T extends ContentBlockType = ContentBlockType> = BlockDataMap[T];
/** A parsed block: discriminated on `type`. */
export type ParsedBlock = { [T in ContentBlockType]: { type: T; data: BlockDataMap[T] } }[ContentBlockType];

export const BLOCK_TYPES = Object.keys(BLOCK_SCHEMAS) as ContentBlockType[];
export const blockTypeSchema = z.enum(BLOCK_TYPES as [ContentBlockType, ...ContentBlockType[]]);

/** Discriminated union `{ type, data }` over all block types. */
export const contentBlockSchema = z.discriminatedUnion(
  "type",
  BLOCK_TYPES.map((t) => z.object({ type: z.literal(t), data: BLOCK_SCHEMAS[t] })) as unknown as [
    z.ZodObject<{ type: z.ZodLiteral<ContentBlockType>; data: z.ZodType }>,
    ...z.ZodObject<{ type: z.ZodLiteral<ContentBlockType>; data: z.ZodType }>[],
  ],
);

export type BlockIssue = { path: string; message: string };
export type ParseBlockResult = { ok: true; block: ParsedBlock } | { ok: false; issues: BlockIssue[] };

/** Validates block data for `type`; never throws. Unknown keys are stripped, defaults filled in. */
export function parseBlock(type: string, data: unknown): ParseBlockResult {
  if (!(BLOCK_TYPES as string[]).includes(type)) return { ok: false, issues: [{ path: "type", message: `Unknown block type ${type}` }] };
  const t = type as ContentBlockType;
  const res = BLOCK_SCHEMAS[t].safeParse(data ?? {});
  if (!res.success) {
    return { ok: false, issues: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  return { ok: true, block: { type: t, data: res.data } as ParsedBlock };
}

/** Ids/keys a block points at, so the service can check they belong to the tenant. */
export function blockReferences(block: ParsedBlock): { imageKeys: string[]; productIds: string[]; categoryIds: string[] } {
  const d = block.data as Partial<Record<string, unknown>>;
  const imageKeys = [
    ...(typeof d.imageKey === "string" ? [d.imageKey] : []),
    ...(Array.isArray(d.imageKeys) ? (d.imageKeys as string[]) : []),
  ];
  const productIds = typeof d.productId === "string" ? [d.productId] : [];
  const categoryIds = Array.isArray(d.categoryIds) ? (d.categoryIds as string[]) : [];
  return { imageKeys, productIds, categoryIds };
}

// ─── Defaults ("add block") ─────────────────────────────────────────────────

const lorem = "Write something about your shop here. **Bold**, *italic* and [links](/shop) are supported.";

/** Starter data per type; every default passes its schema. */
export const BLOCK_DEFAULTS: BlockDataMap = {
  HERO: { title: "Welcome to our shop", subtitle: "Authentic militaria, carefully described and photographed.", imageKey: null, cta: { label: "Browse the shop", href: "/shop" } },
  TEXT: { title: "", markdown: lorem, cta: null },
  TEXT_HORIZONTAL: { title: "Heading", markdown: lorem },
  TEXT_IMAGE: { title: "Heading", markdown: lorem, imageKey: null, imagePosition: "left", cta: null },
  TEXT_PRODUCT: { title: "Featured item", markdown: lorem, productId: null },
  TEXT_CAROUSEL: { title: "Heading", markdown: lorem, imageKeys: [] },
  QUOTE: { quote: "A short quote that sets the tone.", author: "" },
  CTA: { title: "Looking for something specific?", text: "Get in touch and we will help you search.", buttonLabel: "Contact us", href: "/contact", imageKey: null },
  GALLERY: { title: "Gallery", imageKeys: [] },
  TESTIMONIAL: { quote: "Great service and exactly as described.", author: "A happy collector", link: null },
  CATEGORIES: { title: "Shop by category", categoryIds: [] },
  NEW_ITEMS: { title: "New arrivals", count: 6, cta: { label: "View all", href: "/shop" } },
  NEWSLETTER_SIGNUP: { title: "Stay up to date", text: "Receive new arrivals in your inbox." },
};

export function defaultBlockData<T extends ContentBlockType>(type: T): BlockDataMap[T] {
  return structuredClone(BLOCK_DEFAULTS[type]);
}

// ─── Admin picker catalog ───────────────────────────────────────────────────

export type BlockCatalogEntry = {
  type: ContentBlockType;
  label: string;
  description: string;
  /** lucide-react icon name. */
  icon: string;
  group: "text" | "media" | "shop" | "engagement";
  /** Max once per page and always the first block (legacy rule for HERO). */
  firstOnly?: boolean;
  /** Only offered when the tenant has this feature (NEWSLETTER_SIGNUP ↔ platform.newsletterEnabled). */
  requiresFeature?: "newsletter";
};

export const BLOCK_CATALOG: readonly BlockCatalogEntry[] = [
  { type: "HERO", label: "Hero", description: "Large banner with title, subtitle, background image and a button. Always the first block.", icon: "PanelTop", group: "media", firstOnly: true },
  { type: "TEXT", label: "Text", description: "A section of formatted text with an optional button.", icon: "Text", group: "text" },
  { type: "TEXT_HORIZONTAL", label: "Text (two columns)", description: "Heading on the left, text on the right.", icon: "Columns2", group: "text" },
  { type: "TEXT_IMAGE", label: "Text with image", description: "Text next to an image, image left or right.", icon: "ImagePlus", group: "media" },
  { type: "TEXT_PRODUCT", label: "Text with product", description: "Highlight one product with your own text.", icon: "PackageSearch", group: "shop" },
  { type: "TEXT_CAROUSEL", label: "Text with carousel", description: "Text next to a sliding set of images.", icon: "GalleryHorizontal", group: "media" },
  { type: "QUOTE", label: "Quote", description: "A highlighted quote.", icon: "Quote", group: "text" },
  { type: "CTA", label: "Call to action", description: "Short message with a prominent button.", icon: "MousePointerClick", group: "engagement" },
  { type: "GALLERY", label: "Gallery", description: "A grid of images.", icon: "LayoutGrid", group: "media" },
  { type: "TESTIMONIAL", label: "Testimonial", description: "A customer review. Consecutive testimonials are shown as one slider.", icon: "MessageSquareQuote", group: "engagement" },
  { type: "CATEGORIES", label: "Categories", description: "Slider with chosen (or all top-level) categories.", icon: "FolderTree", group: "shop" },
  { type: "NEW_ITEMS", label: "New arrivals", description: "The latest active products (1–24).", icon: "Sparkles", group: "shop" },
  { type: "NEWSLETTER_SIGNUP", label: "Newsletter signup", description: "Sign-up form for the newsletter.", icon: "Mail", group: "engagement", requiresFeature: "newsletter" },
];

export function catalogEntry(type: ContentBlockType): BlockCatalogEntry {
  return BLOCK_CATALOG.find((e) => e.type === type)!;
}
