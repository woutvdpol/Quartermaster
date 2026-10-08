import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { enqueue } from "@/server/jobs/queue";
import { createProductInTx, deleteProduct } from "@/server/catalog/products";
import { nextFreeSlug, slugify } from "@/server/catalog/slug";
import { currencyDigits } from "@/components/admin/ui/money-utils";
import { addProductImages, deleteProductMedia } from "@/server/media/product-images";
import { getStorage } from "@/server/media/storage";
import { safeFetch, SafeFetchError } from "@/server/security/safe-fetch";
import { onProductsPublished } from "@/server/alerts/hooks";
import { invalidateShopForAction } from "@/server/storefront/cache";
import { Prisma } from "@/generated/prisma/client";
import type { ImportJob } from "@/generated/prisma/client";
import { CsvError, decodeCsvBytes, detectDelimiter, parseCsv } from "./csv";
import { categoryKey, planProduct, summarisePlans, type FacetMatch, type FacetMatcher, type PlannedProduct } from "./mapping";
import { looksLikeShopify, parseShopify } from "./shopify";
import { looksLikeWooCommerce, parseWooCommerce } from "./woocommerce";
import {
  DEFAULT_IMPORT_OPTIONS,
  IMPORT_SOURCES,
  ImportFormatError,
  MAX_IMPORT_FILE_MB,
  type ImportFailure,
  type ImportJobView,
  type ImportOptions,
  type ImportPreview,
  type ImportProgress,
  type ImportSourceName,
  type ParsedSource,
  type SourceProduct,
} from "./types";

/*
 * Product import from WooCommerce / Shopify CSV exports (docs/import.md).
 *
 * Flow: upload (CSV stored privately at `{tenantId}/imports/{jobId}.csv`, parsed, preview in
 * ImportJob.summary) → start (options; status RUNNING; job `import.run`) → products are created in
 * small transactions, one per source product → status IMAGES; job `import.images` downloads photos
 * through the SSRF-safe fetcher into the normal image pipeline → DONE. Cancel at any time.
 *
 * Idempotency: every created item carries Product.legacyData { importJobId, sourceId, sourceKey }.
 * A (re-)run skips keys that already exist, so re-running a job never duplicates items; photo
 * progress per item is kept in legacyData too (imagesDone / imagesState).
 *
 * Long jobs: handlers stop after a time budget and queue a continuation (cursor in the payload);
 * the queue runs one handler per import job at a time (policy "singleton" + singletonKey = job id).
 */

type Tx = Prisma.TransactionClient;

export const MAX_IMPORT_FILE_BYTES = MAX_IMPORT_FILE_MB * 1024 * 1024;
const MAX_LISTED = 200;
const MAX_FAILURES = 500;
const PROGRESS_EVERY = 10;
const DEFAULT_BUDGET_MS = 4 * 60 * 1000;

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const optionsSchema = z
  .object({
    publish: z.boolean().default(DEFAULT_IMPORT_OPTIONS.publish),
    tagsAs: z.enum(["facets", "tags"]).default(DEFAULT_IMPORT_OPTIONS.tagsAs),
    stockMode: z.enum(["split", "single"]).default(DEFAULT_IMPORT_OPTIONS.stockMode),
    images: z.boolean().default(DEFAULT_IMPORT_OPTIONS.images),
  })
  .strict();

type Summary = {
  preview?: ImportPreview;
  progress?: ImportProgress;
  failures?: ImportFailure[];
  imageFailures?: ImportFailure[];
  error?: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const importFileKey = (tenantId: string, jobId: string) => `${tenantId}/imports/${jobId}.csv`;
const newJobId = () => `imp${randomBytes(12).toString("hex")}`;
const toJson = (v: unknown) => v as Prisma.InputJsonValue;

function readSummary(job: Pick<ImportJob, "summary">): Summary {
  const s = job.summary;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as unknown as Summary) : {};
}

function readOptions(job: Pick<ImportJob, "options">): ImportOptions {
  const parsed = optionsSchema.safeParse(job.options ?? {});
  return parsed.success ? parsed.data : DEFAULT_IMPORT_OPTIONS;
}

function toView(job: ImportJob): ImportJobView {
  const s = readSummary(job);
  return {
    id: job.id,
    source: job.source,
    status: job.status,
    fileName: job.fileName,
    options: readOptions(job),
    preview: s.preview ?? null,
    progress: s.progress ?? null,
    failures: s.failures ?? [],
    imageFailures: s.imageFailures ?? [],
    error: s.error ?? null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

async function requireJob(tenantId: string, jobId: string): Promise<ImportJob> {
  const id = idSchema.safeParse(jobId);
  const job = id.success ? await db.importJob.findFirst({ where: { id: id.data, tenantId } }) : null;
  if (!job) throw new ServiceError("NOT_FOUND", "Import not found");
  return job;
}

async function tenantDigits(tenantId: string): Promise<number> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  return currencyDigits(t?.currency ?? "EUR");
}

/** Parses the uploaded CSV for the chosen source. ServiceError("INVALID") with a readable message. */
export function parseSourceFile(source: ImportSourceName, text: string): ParsedSource {
  try {
    const table = parseCsv(text);
    if (source === "WOOCOMMERCE" && !looksLikeWooCommerce(table.headers) && looksLikeShopify(table.headers)) {
      throw new ImportFormatError("This is a Shopify export — choose Shopify as the source.");
    }
    if (source === "SHOPIFY" && !looksLikeShopify(table.headers) && looksLikeWooCommerce(table.headers)) {
      throw new ImportFormatError("This is a WooCommerce export — choose WooCommerce as the source.");
    }
    return source === "WOOCOMMERCE" ? parseWooCommerce(table) : parseShopify(table);
  } catch (err) {
    if (err instanceof CsvError || err instanceof ImportFormatError) throw new ServiceError("INVALID", err.message);
    throw err;
  }
}

/** Case-insensitive facet value lookup by name (first facet by sortOrder wins). */
async function facetMatcher(tenantId: string): Promise<FacetMatcher> {
  const values = await db.facetValue.findMany({
    where: { tenantId },
    select: { id: true, name: true, slug: true, facet: { select: { name: true, sortOrder: true } } },
    orderBy: [{ facet: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  const byName = new Map<string, FacetMatch>();
  for (const v of values) {
    for (const key of [v.name.trim().toLowerCase(), v.slug]) {
      if (!byName.has(key)) byName.set(key, { valueId: v.id, facet: v.facet.name, value: v.name });
    }
  }
  return (tag) => byName.get(tag.trim().toLowerCase()) ?? byName.get(slugify(tag)) ?? null;
}

/** Existing category paths of the tenant: key ("a › b") → id. */
async function categoryPathIndex(tx: Tx | typeof db, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx.category.findMany({ where: { tenantId }, select: { id: true, parentId: true, title: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: typeof r | undefined = r;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift(cur.title);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    const key = categoryKey(path);
    if (!out.has(key)) out.set(key, r.id);
  }
  return out;
}

function exampleFor(column: string, p: SourceProduct | undefined, plan: PlannedProduct | undefined, digits: number): string {
  if (!p || !plan) return "";
  const money = (minor: number) => (minor / 10 ** digits).toFixed(digits);
  const b = column.toLowerCase();
  if (b === "name" || b === "title" || b === "naam") return plan.title;
  if (b.includes("sale") || b.includes("compare")) return p.salePrice || "";
  if (b.includes("price") || b.includes("prijs") || b.includes("preis")) return plan.price ? money(plan.price) : "";
  if (b.includes("categor") || b === "type" || b === "kategorien") return plan.categoryPath?.join(" › ") ?? "";
  if (b === "tags" || b === "schlagwörter") return p.tags.slice(0, 4).join(", ");
  if (b.includes("image")) return p.images.length ? `${p.images.length} photo${p.images.length === 1 ? "" : "s"}` : "";
  if (b.includes("stock") || b.includes("qty") || b.includes("voorraad")) return p.stock === null ? "not tracked" : String(p.stock);
  if (b.includes("sku")) return p.sku ?? "";
  if (b.includes("weight") || b.includes("grams") || b.includes("gewicht")) return p.weightGrams !== null ? `${p.weightGrams} g` : "";
  if (b.includes("description") || b.includes("body") || b.includes("beschr")) return (plan.description ?? "").slice(0, 60);
  return "";
}

/** Builds the preview (counts, mapping table, warnings) for a parsed file. */
export async function buildPreview(tenantId: string, parsed: ParsedSource, delimiter: string): Promise<ImportPreview> {
  const digits = await tenantDigits(tenantId);
  const matchFacet = await facetMatcher(tenantId);
  const options: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, publish: true, tagsAs: "facets", stockMode: "split" };
  const plans = parsed.products.map((p) => planProduct(p, options, { digits, matchFacet }));
  const sum = summarisePlans(plans, parsed.products);
  const existingCats = await categoryPathIndex(db, tenantId);
  const existing = sum.categoryPaths.filter((path) => existingCats.has(categoryKey(path))).length;

  const allTags = new Map<string, string>();
  for (const p of parsed.products) for (const t of p.tags) if (t.trim()) allTags.set(t.trim().toLowerCase(), t.trim());
  const facetMatched: ImportPreview["tags"]["facetMatched"] = [];
  const unmatched: string[] = [];
  for (const tag of allTags.values()) {
    const m = matchFacet(tag);
    if (m) facetMatched.push({ tag, facet: m.facet, value: m.value });
    else unmatched.push(tag);
  }

  const skus = [...new Set(plans.map((p) => p.sku).filter((s): s is string => !!s))];
  const skuConflicts = skus.length ? await db.product.count({ where: { tenantId, sku: { in: skus } } }) : 0;

  const warningRows = new Set(sum.warnings.map((w) => w.row));
  const first = parsed.products[0];
  return {
    rows: parsed.rows,
    delimiter,
    products: sum.products,
    itemsIfSplit: sum.itemsIfSplit,
    itemsIfSingle: sum.itemsIfSingle,
    multiStock: sum.multiStock,
    publishable: plans.filter((p) => p.status === "ACTIVE").length,
    images: sum.images,
    categories: {
      total: sum.categoryPaths.length,
      existing,
      new: sum.categoryPaths.length - existing,
      sample: sum.categoryPaths.slice(0, 20).map((p) => p.join(" › ")),
    },
    tags: {
      total: allTags.size,
      facetMatched: facetMatched.slice(0, 50),
      facetMatchedCount: facetMatched.length,
      unmatchedSample: unmatched.slice(0, 50),
    },
    skipped: parsed.skipped.slice(0, MAX_LISTED),
    skippedCount: parsed.skipped.length,
    warnings: [...parsed.notes.map((message) => ({ row: 0, message })), ...sum.warnings].slice(0, MAX_LISTED),
    warningCount: sum.warnings.length + parsed.notes.length,
    attention: new Set([...warningRows, ...parsed.skipped.map((s) => s.row)]).size,
    notes: parsed.notes,
    columns: parsed.columns.map((c) => ({ ...c, example: exampleFor(c.column, first, plans[0], digits).slice(0, 80) })),
    ignoredColumns: parsed.ignoredColumns.slice(0, 100),
    sample: plans.slice(0, 5).map((p, i) => ({
      row: p.row,
      title: p.title,
      price: p.price,
      onSale: p.onSale,
      category: p.categoryPath?.join(" › ") ?? null,
      tags: [...p.facets.map((f) => f.value), ...p.tags].slice(0, 6),
      images: p.images.length,
      stock: parsed.products[i].stock,
    })),
    skuConflicts,
  };
}

// ─── Admin services ─────────────────────────────────────────────────────────

const uploadSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  fileName: z.string().trim().min(1).max(255),
  bytes: z.instanceof(Uint8Array),
});

/**
 * Stores and parses an uploaded export. Returns the job with its preview (status UPLOADED).
 * INVALID for an empty / too large / unreadable file or one without importable products.
 */
export async function createImportJob(ctx: ServiceContext, input: { source: ImportSourceName; fileName: string; bytes: Uint8Array }): Promise<ImportJobView> {
  const parsedInput = uploadSchema.safeParse(input);
  if (!parsedInput.success) throw new ServiceError("INVALID", "Invalid upload");
  const { source, bytes } = parsedInput.data;
  const fileName = parsedInput.data.fileName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
  if (bytes.byteLength === 0) throw new ServiceError("INVALID", "The file is empty.");
  if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new ServiceError("INVALID", `The file is larger than ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB.`);
  }
  if (bytes.subarray(0, 8192).includes(0)) throw new ServiceError("INVALID", "This is not a CSV file.");

  const text = decodeCsvBytes(bytes);
  const parsed = parseSourceFile(source, text);
  if (parsed.products.length === 0) {
    throw new ServiceError("INVALID", parsed.skipped.length ? "No importable products found — every row was skipped." : "No products found in the file.", {
      skipped: parsed.skipped.slice(0, 20),
    });
  }
  const preview = await buildPreview(ctx.tenantId, parsed, detectDelimiter(text));

  const id = newJobId();
  const fileKey = importFileKey(ctx.tenantId, id);
  const storage = getStorage();
  await storage.put(fileKey, bytes, "text/csv");
  let job: ImportJob;
  try {
    job = await db.importJob.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        source,
        fileName,
        fileKey,
        options: toJson(DEFAULT_IMPORT_OPTIONS),
        summary: toJson({ preview } satisfies Summary),
        createdById: ctx.actor.id,
      },
    });
  } catch (err) {
    await storage.delete(fileKey).catch(() => {});
    throw err;
  }
  await audit({
    action: "import.upload",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "ImportJob",
    entityId: job.id,
    data: { source, fileName, bytes: bytes.byteLength, products: preview.products },
  });
  return toView(job);
}

export async function getImportJob(ctx: ServiceContext, jobId: string): Promise<ImportJobView> {
  return toView(await requireJob(ctx.tenantId, jobId));
}

/** Recent imports of the tenant (newest first). */
export async function listImportJobs(ctx: ServiceContext, limit = 10): Promise<ImportJobView[]> {
  const rows = await db.importJob.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 50) });
  return rows.map(toView);
}

/** UPLOADED → RUNNING with the chosen options; queues `import.run`. CONFLICT when already started. */
export async function startImport(ctx: ServiceContext, jobId: string, options: Partial<ImportOptions>): Promise<ImportJobView> {
  const job = await requireJob(ctx.tenantId, jobId);
  const parsed = optionsSchema.safeParse(options ?? {});
  if (!parsed.success) throw new ServiceError("INVALID", "Invalid import options");
  const opts = parsed.data;
  await db.$transaction(async (tx) => {
    const res = await tx.importJob.updateMany({
      where: { id: job.id, tenantId: ctx.tenantId, status: "UPLOADED" },
      data: { status: "RUNNING", options: toJson(opts), startedAt: new Date() },
    });
    if (res.count === 0) throw new ServiceError("CONFLICT", "This import has already been started.");
    await enqueue("import.run", { tenantId: ctx.tenantId, jobId: job.id }, { tx, singletonKey: job.id });
  });
  await audit({ action: "import.start", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ImportJob", entityId: job.id, data: toJson(opts) });
  return getImportJob(ctx, job.id);
}

/** FAILED → RUNNING again (idempotent: items that exist already are not created twice). */
export async function retryImport(ctx: ServiceContext, jobId: string): Promise<ImportJobView> {
  const job = await requireJob(ctx.tenantId, jobId);
  await db.$transaction(async (tx) => {
    const res = await tx.importJob.updateMany({ where: { id: job.id, tenantId: ctx.tenantId, status: "FAILED" }, data: { status: "RUNNING", finishedAt: null } });
    if (res.count === 0) throw new ServiceError("CONFLICT", "Only a failed import can be retried.");
    await enqueue("import.run", { tenantId: ctx.tenantId, jobId: job.id }, { tx, singletonKey: job.id });
  });
  await audit({ action: "import.retry", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ImportJob", entityId: job.id });
  return getImportJob(ctx, job.id);
}

/** Stops an import that has not finished. Items created so far stay (as created). */
export async function cancelImport(ctx: ServiceContext, jobId: string): Promise<ImportJobView> {
  const job = await requireJob(ctx.tenantId, jobId);
  const res = await db.importJob.updateMany({
    where: { id: job.id, tenantId: ctx.tenantId, status: { in: ["UPLOADED", "RUNNING", "IMAGES"] } },
    data: { status: "CANCELED", finishedAt: new Date() },
  });
  if (res.count === 0) throw new ServiceError("CONFLICT", "This import has already finished.");
  await audit({ action: "import.cancel", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ImportJob", entityId: job.id, data: { from: job.status } });
  return getImportJob(ctx, job.id);
}

/** Deletes an import that was never started (row + uploaded file). */
export async function discardImport(ctx: ServiceContext, jobId: string): Promise<void> {
  const job = await requireJob(ctx.tenantId, jobId);
  const res = await db.importJob.deleteMany({ where: { id: job.id, tenantId: ctx.tenantId, status: "UPLOADED" } });
  if (res.count === 0) throw new ServiceError("CONFLICT", "Only an import that has not started can be discarded.");
  await getStorage().delete(job.fileKey).catch(() => {});
  await audit({ action: "import.discard", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ImportJob", entityId: job.id, data: { fileName: job.fileName } });
}

/**
 * "Undo": hard-deletes the DRAFT items this import created (and their photos). Items that were
 * published, sold or changed stock are kept (deleteProduct refuses them). Not while running.
 */
export async function deleteImportedDrafts(ctx: ServiceContext, jobId: string): Promise<{ deleted: number; kept: number }> {
  const job = await requireJob(ctx.tenantId, jobId);
  if (job.status === "RUNNING" || job.status === "IMAGES") throw new ServiceError("CONFLICT", "Cancel the import before deleting its items.");
  const products = await db.product.findMany({
    where: { tenantId: ctx.tenantId, legacyData: { path: ["importJobId"], equals: job.id } },
    select: { id: true, status: true },
  });
  let deleted = 0;
  let kept = 0;
  for (const p of products) {
    if (p.status !== "DRAFT") {
      kept++;
      continue;
    }
    try {
      await deleteProduct(ctx, p.id);
      await deleteProductMedia(ctx, p.id);
      deleted++;
    } catch (err) {
      if (err instanceof ServiceError) kept++;
      else throw err;
    }
  }
  await audit({ action: "import.undo", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ImportJob", entityId: job.id, data: { deleted, kept } });
  return { deleted, kept };
}

// ─── Worker: products ───────────────────────────────────────────────────────

async function workerContext(job: ImportJob): Promise<ServiceContext> {
  const user =
    (job.createdById ? await db.user.findUnique({ where: { id: job.createdById }, select: { id: true, role: true, tenantId: true, email: true } }) : null) ??
    (await db.user.findFirst({ where: { tenantId: job.tenantId, role: "OWNER" }, select: { id: true, role: true, tenantId: true, email: true } }));
  if (!user) throw new Error(`Import ${job.id}: no user to act as`);
  return { tenantId: job.tenantId, actor: user };
}

async function loadSourceFile(job: ImportJob): Promise<string> {
  const obj = await getStorage().get(job.fileKey);
  if (!obj) throw new Error("The uploaded file is missing from storage");
  return decodeCsvBytes(new Uint8Array(await new Response(obj.body).arrayBuffer()));
}

async function saveSummary(jobId: string, patch: Partial<Summary>) {
  const job = await db.importJob.findUnique({ where: { id: jobId }, select: { summary: true } });
  const current = job ? readSummary(job) : {};
  await db.importJob.update({ where: { id: jobId }, data: { summary: toJson({ ...current, ...patch }) } });
}

async function currentStatus(jobId: string) {
  return (await db.importJob.findUnique({ where: { id: jobId }, select: { status: true } }))?.status ?? null;
}

/** Creates the missing categories of every path (one transaction, tree lock). Returns key → id. */
async function ensureCategories(ctx: ServiceContext, paths: string[][]): Promise<Map<string, string>> {
  const created: { id: string; title: string }[] = [];
  const index = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"category-tree:" + ctx.tenantId}))`;
    const idx = await categoryPathIndex(tx, ctx.tenantId);
    for (const path of paths) {
      let parentId: string | null = null;
      for (let n = 1; n <= path.length; n++) {
        const key = categoryKey(path.slice(0, n));
        let id: string | undefined = idx.get(key);
        if (!id) {
          const title = path[n - 1];
          const base = slugify(title) || "category";
          const taken = await tx.category.findMany({ where: { tenantId: ctx.tenantId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] }, select: { slug: true } });
          const agg = await tx.category.aggregate({ where: { tenantId: ctx.tenantId, parentId }, _max: { sortOrder: true } });
          const cat: { id: string; title: string } = await tx.category.create({
            data: { tenantId: ctx.tenantId, parentId, title, slug: nextFreeSlug(base, taken.map((t) => t.slug)), sortOrder: (agg._max.sortOrder ?? -1) + 1 },
            select: { id: true, title: true },
          });
          id = cat.id;
          idx.set(key, id);
          created.push(cat);
        }
        parentId = id;
      }
    }
    return idx;
  });
  for (const c of created) {
    await audit({ action: "category.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Category", entityId: c.id, data: { title: c.title, via: "import" } });
  }
  return index;
}

/** Finds or creates plain tags (case-insensitive). Returns lower-case name → id. */
async function ensureTags(ctx: ServiceContext, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!names.length) return out;
  const created: { id: string; name: string }[] = [];
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tags:" + ctx.tenantId}))`;
    const existing = await tx.tag.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true, slug: true } });
    const slugs = new Set(existing.map((t) => t.slug));
    for (const t of existing) out.set(t.name.toLowerCase(), t.id);
    for (const name of names) {
      const key = name.toLowerCase();
      if (out.has(key)) continue;
      const slug = nextFreeSlug(slugify(name) || "tag", slugs);
      slugs.add(slug);
      const tag = await tx.tag.create({ data: { tenantId: ctx.tenantId, name, slug }, select: { id: true, name: true } });
      out.set(key, tag.id);
      created.push(tag);
    }
  });
  for (const t of created) {
    await audit({ action: "tag.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tag", entityId: t.id, data: { name: t.name, via: "import" } });
  }
  return out;
}

export type RunResult = { done: boolean; cursor: number };

/**
 * Creates the items of an import job, from source product `cursor` on. Stops (returns done=false)
 * when the job is no longer RUNNING (canceled) or the time budget is used up; the job handler then
 * queues a continuation. Safe to run again: existing items (by sourceKey) are skipped.
 */
export async function runImportProducts(tenantId: string, jobId: string, opts: { cursor?: number; budgetMs?: number } = {}): Promise<RunResult> {
  const job = await db.importJob.findFirst({ where: { id: jobId, tenantId } });
  if (!job || job.status !== "RUNNING") return { done: true, cursor: opts.cursor ?? 0 };
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const ctx = await workerContext(job);
  const options = readOptions(job);
  const parsed = parseSourceFile(job.source, await loadSourceFile(job));
  const digits = await tenantDigits(tenantId);
  const matchFacet = options.tagsAs === "facets" ? await facetMatcher(tenantId) : undefined;
  const plans = parsed.products.map((p) => planProduct(p, options, { digits, matchFacet }));
  const summary = readSummary(job);
  const fresh = !opts.cursor;
  const failures: ImportFailure[] = fresh ? [] : (summary.failures ?? []);

  // Shared lookups (categories / tags are created once, up front).
  const categories = await ensureCategories(
    ctx,
    [...new Map(plans.filter((p) => p.categoryPath).map((p) => [categoryKey(p.categoryPath!), p.categoryPath!])).values()],
  );
  const tagIds = await ensureTags(ctx, [...new Map(plans.flatMap((p) => p.tags).map((t) => [t.toLowerCase(), t])).values()]);
  const existingRows = await db.product.findMany({
    where: { tenantId, legacyData: { path: ["importJobId"], equals: job.id } },
    select: { legacyData: true, status: true },
  });
  const existingKeys = new Set(existingRows.map((r) => (r.legacyData as { sourceKey?: string } | null)?.sourceKey).filter(Boolean));
  const skus = [...new Set(plans.flatMap((p) => (p.sku ? [p.sku, ...Array.from({ length: p.units - 1 }, (_, i) => `${p.sku}-${i + 2}`)] : [])))];
  const usedSkus = new Set(
    skus.length ? (await db.product.findMany({ where: { tenantId, sku: { in: skus } }, select: { sku: true } })).map((r) => r.sku) : [],
  );

  const progress: ImportProgress = {
    phase: "products",
    processed: opts.cursor ?? 0,
    products: plans.length,
    created: existingRows.length,
    existing: fresh ? 0 : (summary.progress?.existing ?? 0),
    failed: failures.length,
    published: existingRows.filter((r) => r.status === "ACTIVE").length,
    imagesTotal: 0,
    imagesDone: 0,
    imagesFailed: 0,
  };
  const published: string[] = [];
  const flush = async () => {
    await saveSummary(job.id, { progress: { ...progress, failed: failures.length }, failures: failures.slice(0, MAX_FAILURES) });
  };

  const start = opts.cursor ?? 0;
  let canceled = false;
  let i = start;
  for (; i < plans.length; i++) {
    if (i > start) {
      if (Date.now() > deadline) break;
      if ((i - start) % PROGRESS_EVERY === 0) {
        await flush();
        if ((await currentStatus(job.id)) !== "RUNNING") {
          canceled = true;
          break;
        }
      }
    }
    const plan = plans[i];
    const source = parsed.products[i];
    const keys = Array.from({ length: plan.units }, (_, u) => `${plan.sourceId}#${u + 1}`);
    if (keys.every((k) => existingKeys.has(k))) {
      progress.existing += keys.length;
      progress.processed = i + 1;
      continue;
    }
    try {
      const createdIds = await db.$transaction(async (tx) => {
        const ids: { id: string; status: string }[] = [];
        for (const [u, key] of keys.entries()) {
          if (existingKeys.has(key)) continue;
          let sku: string | null = plan.sku ? (u === 0 ? plan.sku : `${plan.sku}-${u + 1}`) : null;
          if (sku && usedSkus.has(sku)) sku = null;
          const product = await createProductInTx(
            tx,
            ctx,
            {
              title: plan.title,
              description: plan.description,
              sku,
              price: plan.price,
              purchasePrice: plan.purchasePrice,
              weightGrams: plan.weightGrams,
              onSale: plan.onSale,
              seoTitle: plan.seoTitle,
              seoDescription: plan.seoDescription,
              categoryId: plan.categoryPath ? (categories.get(categoryKey(plan.categoryPath)) ?? null) : null,
              tagIds: plan.tags.map((t) => tagIds.get(t.toLowerCase())).filter((t): t is string => !!t),
              quantity: plan.quantity,
              status: plan.status,
            },
            {
              note: `Opening stock (import ${job.source === "WOOCOMMERCE" ? "WooCommerce" : "Shopify"} row ${plan.row})`,
              legacyData: toJson({
                importJobId: job.id,
                source: job.source,
                sourceId: plan.sourceId,
                sourceKey: key,
                unit: u + 1,
                row: plan.row,
                originalSku: source.sku,
                regularPrice: plan.regularPrice,
                images: options.images ? plan.images : [],
                imagesDone: 0,
                imagesState: options.images && plan.images.length ? "pending" : "done",
              }),
            },
          );
          if (plan.facets.length) {
            await tx.productFacetValue.createMany({
              data: plan.facets.map((f) => ({ tenantId, productId: product.id, facetValueId: f.valueId })),
              skipDuplicates: true,
            });
          }
          if (sku) usedSkus.add(sku);
          ids.push({ id: product.id, status: product.status });
        }
        return ids;
      });
      for (const k of keys) existingKeys.add(k);
      progress.created += createdIds.length;
      for (const c of createdIds) if (c.status === "ACTIVE") published.push(c.id);
      progress.published += createdIds.filter((c) => c.status === "ACTIVE").length;
    } catch (err) {
      const reason = err instanceof ServiceError ? err.message : "Could not create the product";
      if (!(err instanceof ServiceError)) console.error(`[import] ${job.id} row ${plan.row}`, err);
      failures.push({ row: plan.row, title: plan.title, reason });
    }
    progress.processed = i + 1;
  }

  if (published.length) {
    await audit({ action: "import.published", tenantId, actorId: ctx.actor.id, entity: "ImportJob", entityId: job.id, data: { count: published.length } });
    await onProductsPublished(tenantId, published);
  }
  invalidateShopForAction(tenantId, "product.import");

  if (i < plans.length) {
    await flush();
    return { done: canceled, cursor: i };
  }

  // Products done → photos (or finished).
  const imagesTotal = await countPendingImages(tenantId, job.id);
  progress.phase = imagesTotal > 0 ? "images" : "done";
  progress.imagesTotal = imagesTotal;
  await flush();
  const next = imagesTotal > 0 ? "IMAGES" : "DONE";
  const moved = await db.$transaction(async (tx) => {
    const res = await tx.importJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: { status: next, ...(next === "DONE" ? { finishedAt: new Date() } : {}) },
    });
    if (res.count && next === "IMAGES") await enqueue("import.images", { tenantId, jobId: job.id }, { tx, singletonKey: job.id });
    return res.count > 0;
  });
  if (moved) {
    await audit({
      action: "import.products_done",
      tenantId,
      actorId: ctx.actor.id,
      entity: "ImportJob",
      entityId: job.id,
      data: { created: progress.created, existing: progress.existing, failed: failures.length, images: imagesTotal },
    });
  }
  return { done: true, cursor: i };
}

async function countPendingImages(tenantId: string, jobId: string): Promise<number> {
  const [row] = await db.$queryRaw<{ n: bigint | null }[]>`
    SELECT COALESCE(SUM(GREATEST(jsonb_array_length(COALESCE(p."legacyData"->'images', '[]'::jsonb)) - COALESCE((p."legacyData"->>'imagesDone')::int, 0), 0)), 0)::bigint AS n
    FROM products p
    WHERE p."tenantId" = ${tenantId} AND p."legacyData"->>'importJobId' = ${jobId} AND p."legacyData"->>'imagesState' = 'pending'`;
  return Number(row?.n ?? 0);
}

/** Marks a job FAILED (final attempt of a handler). */
export async function failImport(tenantId: string, jobId: string, message: string): Promise<void> {
  const res = await db.importJob.updateMany({ where: { id: jobId, tenantId, status: { in: ["RUNNING", "IMAGES"] } }, data: { status: "FAILED", finishedAt: new Date() } });
  if (res.count) {
    await saveSummary(jobId, { error: message.slice(0, 500) });
    await audit({ action: "import.failed", tenantId, entity: "ImportJob", entityId: jobId, data: { error: message.slice(0, 500) } });
  }
}

// ─── Worker: photos ─────────────────────────────────────────────────────────

export type ImageFetcher = (url: string, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; contentType: string }>;

const defaultFetcher: ImageFetcher = (url, signal) => safeFetch(url, { signal });
let fetcher: ImageFetcher = defaultFetcher;

/** Tests only: replace the image downloader (null restores the SSRF-safe default). */
export function setImportImageFetcherForTests(f: ImageFetcher | null): void {
  fetcher = f ?? defaultFetcher;
}

function fileNameFromUrl(url: string, contentType: string): string {
  let name = "photo";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "photo");
  } catch {
    // keep default
  }
  name = name.replace(/[^\w.\-]+/g, "_").slice(0, 100) || "photo";
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += `.${contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "img"}`;
  return name;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const s = `${u.host}${u.pathname}`;
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return url.slice(0, 120);
  }
}

type LegacyImport = { sourceId?: string; row?: number; images?: string[]; imagesDone?: number; imagesState?: string };

/**
 * Downloads the photos of a job's items (status IMAGES) until done, canceled or out of time.
 * Per item, progress is stored in legacyData.imagesDone so a retry continues where it stopped; a
 * download shared by split items (same source) is fetched once per run.
 */
export async function runImportImages(tenantId: string, jobId: string, opts: { budgetMs?: number; signal?: AbortSignal } = {}): Promise<RunResult> {
  const job = await db.importJob.findFirst({ where: { id: jobId, tenantId } });
  if (!job || job.status !== "IMAGES") return { done: true, cursor: 0 };
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const ctx = await workerContext(job);
  const summary = readSummary(job);
  const progress: ImportProgress = summary.progress ?? {
    phase: "images",
    processed: 0,
    products: 0,
    created: 0,
    existing: 0,
    failed: 0,
    published: 0,
    imagesTotal: 0,
    imagesDone: 0,
    imagesFailed: 0,
  };
  progress.phase = "images";
  const imageFailures = summary.imageFailures ?? [];
  const cache = new Map<string, { bytes: Uint8Array; contentType: string } | { error: string }>();
  let cacheSource: string | null = null;
  let quotaHit = false;
  let outOfTime = false;
  let lastFlush = Date.now();

  const flush = async () => {
    progress.imagesFailed = imageFailures.length;
    await saveSummary(job.id, { progress, imageFailures: imageFailures.slice(0, MAX_FAILURES) });
    lastFlush = Date.now();
  };

  outer: for (;;) {
    const batch = await db.product.findMany({
      where: { tenantId, AND: [{ legacyData: { path: ["importJobId"], equals: job.id } }, { legacyData: { path: ["imagesState"], equals: "pending" } }] },
      orderBy: { stockCode: "asc" },
      take: 50,
      select: { id: true, title: true, legacyData: true },
    });
    if (!batch.length) break;
    for (const product of batch) {
      if ((await currentStatus(job.id)) !== "IMAGES") {
        await flush();
        return { done: true, cursor: 0 };
      }
      if (Date.now() > deadline) {
        outOfTime = true;
        break outer;
      }
      const legacy = (product.legacyData ?? {}) as LegacyImport & Record<string, unknown>;
      const urls = Array.isArray(legacy.images) ? legacy.images.filter((u): u is string => typeof u === "string") : [];
      if (legacy.sourceId !== cacheSource) {
        cache.clear();
        cacheSource = legacy.sourceId ?? null;
      }
      for (let n = legacy.imagesDone ?? 0; n < urls.length; n++) {
        const url = urls[n];
        if (!quotaHit) {
          let got = cache.get(url);
          if (!got) {
            try {
              got = await fetcher(url, opts.signal);
            } catch (err) {
              got = { error: err instanceof SafeFetchError ? err.message : "Download failed" };
            }
            cache.set(url, got);
          }
          if ("error" in got) {
            imageFailures.push({ row: legacy.row ?? 0, title: product.title, reason: `${shortUrl(url)}: ${got.error}` });
          } else {
            try {
              await addProductImages(ctx, product.id, [{ name: fileNameFromUrl(url, got.contentType), type: got.contentType, bytes: got.bytes }]);
              progress.imagesDone++;
            } catch (err) {
              if (err instanceof ServiceError && err.code === "CONFLICT" && /quota/i.test(err.message)) {
                quotaHit = true;
                imageFailures.push({ row: legacy.row ?? 0, title: product.title, reason: "Storage quota exceeded — remaining photos were not downloaded." });
              } else {
                imageFailures.push({ row: legacy.row ?? 0, title: product.title, reason: `${shortUrl(url)}: ${err instanceof ServiceError ? err.message : "Could not process the photo"}` });
                if (!(err instanceof ServiceError)) console.error(`[import] ${job.id} photo`, err);
              }
            }
          }
        }
        await db.$executeRaw`UPDATE products SET "legacyData" = jsonb_set("legacyData", '{imagesDone}', to_jsonb(${n + 1}::int)) WHERE id = ${product.id}`;
      }
      await db.$executeRaw`UPDATE products SET "legacyData" = jsonb_set("legacyData", '{imagesState}', '"done"'::jsonb) WHERE id = ${product.id}`;
      if (Date.now() - lastFlush > 2000) await flush();
    }
  }

  if (outOfTime) {
    await flush();
    return { done: false, cursor: 0 };
  }
  progress.phase = "done";
  await flush();
  const res = await db.importJob.updateMany({ where: { id: job.id, status: "IMAGES" }, data: { status: "DONE", finishedAt: new Date() } });
  if (res.count) {
    await audit({
      action: "import.done",
      tenantId,
      actorId: ctx.actor.id,
      entity: "ImportJob",
      entityId: job.id,
      data: { imagesDone: progress.imagesDone, imagesFailed: imageFailures.length, quotaExceeded: quotaHit },
    });
  }
  return { done: true, cursor: 0 };
}
