import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { isUniqueViolation, parseInput } from "@/server/catalog/errors";
import { Prisma } from "@/generated/prisma/client";
import { normalizeRedirectPath } from "./normalize";
import { isReservedPath, toSafeTarget, validateRedirectLink, type StoredRedirect } from "./rules";

export { normalizeRedirectPath } from "./normalize";

/*
 * Redirects admin (phase 4). Exact-path redirects per shop, served only when the storefront would
 * otherwise 404 (src/server/redirects/runtime.ts). LEGACY rows come from the Concept500 ETL and can
 * only be deleted; MANUAL rows are managed by the owner. Every mutation is audited as `redirect.*`,
 * which revalidates the shop's redirect cache (src/server/storefront/cache.ts).
 */

const idSchema = z.string().trim().min(1).max(64);

/** Shop's own hosts: absolute target URLs on these are stored as relative paths. */
async function shopHosts(tenantId: string): Promise<string[]> {
  const rows = await db.tenantDomain.findMany({ where: { tenantId }, select: { host: true } });
  return rows.map((r) => r.host);
}

export const redirectInputSchema = z.object({
  fromPath: z.string().trim().min(1, "Enter the old path").max(1000),
  toPath: z.string().trim().min(1, "Enter the target").max(2000),
  statusCode: z.coerce.number().int().pipe(z.union([z.literal(301), z.literal(302)])).default(301),
});
export type RedirectInput = z.input<typeof redirectInputSchema>;

function invalid(path: "fromPath" | "toPath", message: string): ServiceError {
  return new ServiceError("INVALID", `${path}: ${message}`, [{ path, message }]);
}

/** Validates + normalises one redirect. `excludeId`: the row being edited (ignored by loop checks). */
async function prepare(ctx: ServiceContext, input: RedirectInput, hosts: string[], excludeId?: string) {
  const data = parseInput(redirectInputSchema, input);
  const fromPath = normalizeRedirectPath(data.fromPath);
  if (!fromPath) throw invalid("fromPath", "Enter a path like /old-page (or a full URL of the old shop)");
  if (fromPath === "/") throw invalid("fromPath", "The home page can't be redirected");
  if (isReservedPath(fromPath)) throw invalid("fromPath", "Admin, API and upload paths can't be redirected");
  const toPath = toSafeTarget(data.toPath, hosts);
  if (!toPath) throw invalid("toPath", "Enter a path in this shop (like /shop/category/medals) or a URL on one of the shop's own domains");
  const lookup = async (key: string): Promise<StoredRedirect | null> => {
    const row = await db.redirect.findUnique({
      where: { tenantId_fromPath: { tenantId: ctx.tenantId, fromPath: key } },
      select: { id: true, fromPath: true, toPath: true, statusCode: true },
    });
    return row && row.id !== excludeId ? row : null;
  };
  const problem = await validateRedirectLink(fromPath, toPath, lookup);
  if (problem) throw invalid("toPath", problem);
  return { fromPath, toPath, statusCode: data.statusCode };
}

const DUPLICATE = "A redirect for this path already exists";

// ─── Reads ──────────────────────────────────────────────────────────────────

export const REDIRECT_SORTS = ["createdAt", "hits", "lastHitAt", "fromPath"] as const;
export type RedirectSort = (typeof REDIRECT_SORTS)[number];

const listSchema = z.object({
  source: z.enum(["all", "MANUAL", "LEGACY"]).default("all"),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(REDIRECT_SORTS).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type RedirectRow = {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  source: "LEGACY" | "MANUAL";
  hits: number;
  lastHitAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function orderBy(sort: RedirectSort, dir: "asc" | "desc"): Prisma.RedirectOrderByWithRelationInput[] {
  const tie: Prisma.RedirectOrderByWithRelationInput = { id: "asc" };
  switch (sort) {
    case "hits":
      return [{ hits: dir }, { fromPath: "asc" }, tie];
    case "lastHitAt":
      return [{ lastHitAt: { sort: dir, nulls: "last" } }, { fromPath: "asc" }, tie];
    case "fromPath":
      return [{ fromPath: dir }, tie];
    default:
      return [{ createdAt: dir }, tie];
  }
}

export async function listRedirects(ctx: ServiceContext, query: z.input<typeof listSchema> = {}) {
  const q = listSchema.parse(query);
  const where: Prisma.RedirectWhereInput = {
    tenantId: ctx.tenantId,
    ...(q.source !== "all" ? { source: q.source } : {}),
    ...(q.q ? { OR: [{ fromPath: { contains: q.q, mode: "insensitive" } }, { toPath: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, grouped] = await Promise.all([
    db.redirect.findMany({ where, orderBy: orderBy(q.sort, q.dir), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.redirect.count({ where }),
    db.redirect.groupBy({ by: ["source"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
  ]);
  const count = (s: "LEGACY" | "MANUAL") => grouped.find((g) => g.source === s)?._count._all ?? 0;
  return {
    rows: rows as RedirectRow[],
    total,
    page: q.page,
    pageSize: q.pageSize,
    counts: { all: count("LEGACY") + count("MANUAL"), MANUAL: count("MANUAL"), LEGACY: count("LEGACY") },
  };
}

export async function getRedirect(ctx: ServiceContext, id: string): Promise<RedirectRow> {
  const row = await db.redirect.findFirst({ where: { id: idSchema.parse(id), tenantId: ctx.tenantId } });
  if (!row) throw new ServiceError("NOT_FOUND", "Redirect not found");
  return row as RedirectRow;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export async function createRedirect(ctx: ServiceContext, input: RedirectInput) {
  const data = await prepare(ctx, input, await shopHosts(ctx.tenantId));
  try {
    const row = await db.redirect.create({ data: { tenantId: ctx.tenantId, ...data, source: "MANUAL" } });
    await audit({ action: "redirect.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "redirect", entityId: row.id, data });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw invalid("fromPath", DUPLICATE);
    throw err;
  }
}

/** Edits a MANUAL redirect. LEGACY (imported) redirects can only be deleted. */
export async function updateRedirect(ctx: ServiceContext, id: string, input: RedirectInput) {
  const existing = await db.redirect.findFirst({ where: { id: idSchema.parse(id), tenantId: ctx.tenantId } });
  if (!existing) throw new ServiceError("NOT_FOUND", "Redirect not found");
  if (existing.source !== "MANUAL") throw new ServiceError("CONFLICT", "Imported redirects can't be edited — delete it and add your own instead");
  const data = await prepare(ctx, input, await shopHosts(ctx.tenantId), existing.id);
  try {
    const row = await db.redirect.update({ where: { id: existing.id }, data });
    await audit({ action: "redirect.update", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "redirect", entityId: row.id, data: { before: { fromPath: existing.fromPath, toPath: existing.toPath, statusCode: existing.statusCode }, after: data } });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw invalid("fromPath", DUPLICATE);
    throw err;
  }
}

export async function deleteRedirect(ctx: ServiceContext, id: string) {
  const row = await db.redirect.findFirst({ where: { id: idSchema.parse(id), tenantId: ctx.tenantId } });
  if (!row) throw new ServiceError("NOT_FOUND", "Redirect not found");
  await db.redirect.delete({ where: { id: row.id } });
  await audit({ action: "redirect.delete", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "redirect", entityId: row.id, data: { fromPath: row.fromPath, toPath: row.toPath, source: row.source } });
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/** Parses one CSV line (RFC 4180 quoting, `,` or `;` separator). */
export function parseCsvLine(line: string, sep: "," | ";" = ","): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  // Quote when needed; prefix formula-looking cells so spreadsheets don't execute them.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** All redirects of the shop as CSV (from,to,status,source,hits,last_hit). */
export async function exportRedirectsCsv(ctx: ServiceContext, source: "all" | "MANUAL" | "LEGACY" = "all"): Promise<string> {
  const rows = await db.redirect.findMany({
    where: { tenantId: ctx.tenantId, ...(source !== "all" ? { source } : {}) },
    orderBy: { fromPath: "asc" },
    select: { fromPath: true, toPath: true, statusCode: true, source: true, hits: true, lastHitAt: true },
  });
  const lines = ["from,to,status,source,hits,last_hit"];
  for (const r of rows) lines.push([r.fromPath, r.toPath, r.statusCode, r.source, r.hits, r.lastHitAt?.toISOString() ?? null].map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

export const MAX_IMPORT_ROWS = 2000;

export type ImportResult = { created: number; updated: number; errors: { line: number; message: string }[] };

/**
 * Imports `from,to[,status]` lines as MANUAL redirects (a header line is skipped). An existing redirect
 * for the same path is replaced (an imported LEGACY row becomes MANUAL). Invalid lines are reported
 * and skipped; valid lines are applied.
 */
export async function importRedirectsCsv(ctx: ServiceContext, csv: string): Promise<ImportResult> {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const sep = (lines[0] ?? "").includes(";") && !(lines[0] ?? "").includes(",") ? ";" : ",";
  const nonEmpty = lines.filter((l) => l.trim()).length;
  if (nonEmpty > MAX_IMPORT_ROWS + 1) throw new ServiceError("INVALID", `file: At most ${MAX_IMPORT_ROWS} redirects per import`, [{ path: "file", message: `At most ${MAX_IMPORT_ROWS} redirects per import` }]);
  const hosts = await shopHosts(ctx.tenantId);
  const result: ImportResult = { created: 0, updated: 0, errors: [] };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const [from = "", to = "", status = ""] = parseCsvLine(line, sep);
    if (i === 0 && /^(from|old|source)/i.test(from) && !from.startsWith("/")) continue; // header
    try {
      const existing = normalizeRedirectPath(from)
        ? await db.redirect.findUnique({ where: { tenantId_fromPath: { tenantId: ctx.tenantId, fromPath: normalizeRedirectPath(from)! } }, select: { id: true } })
        : null;
      const data = await prepare(ctx, { fromPath: from, toPath: to, statusCode: status || 301 }, hosts, existing?.id);
      if (existing) {
        await db.redirect.update({ where: { id: existing.id }, data: { ...data, source: "MANUAL" } });
        result.updated++;
      } else {
        await db.redirect.create({ data: { tenantId: ctx.tenantId, ...data, source: "MANUAL" } });
        result.created++;
      }
    } catch (err) {
      if (err instanceof ServiceError) {
        const detail = Array.isArray(err.details) ? (err.details[0] as { message?: string } | undefined)?.message : undefined;
        result.errors.push({ line: i + 1, message: detail ?? err.message });
      } else if (isUniqueViolation(err)) result.errors.push({ line: i + 1, message: DUPLICATE });
      else throw err;
    }
  }
  if (result.created || result.updated) {
    await audit({ action: "redirect.import", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "redirect", data: { created: result.created, updated: result.updated, errors: result.errors.length } });
  }
  return result;
}
