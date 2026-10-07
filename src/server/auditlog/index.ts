import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { type ServiceContext } from "@/server/context";
import { AuthError, canAccessTenant } from "@/server/auth/guards";
import { parseInput } from "@/server/catalog/errors";
import { assertPlatformActor, type PlatformContext } from "@/server/platform/context";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { summarizeAudit } from "./summary";

export { summarizeAudit, KNOWN_AUDIT_ACTIONS } from "./summary";

/*
 * Audit log queries.
 * - `queryAuditLog(ctx)` only ever reads rows with tenantId = ctx.tenantId.
 * - `queryPlatformAuditLog(pctx)` (SUPERADMIN) reads platform-level rows (tenantId NULL: superadmin
 *   logins, platform-host login failures, superadmin account changes), optionally all tenants.
 * - Keyset pagination on the BigInt id (newest first); `nextCursor` is an opaque string.
 * - Privacy: when an OWNER views their log, entries made by a SUPERADMIN show "Quartermaster staff"
 *   without e-mail/IP, so platform staff identities and IPs are not disclosed to shop owners.
 */

const filterSchema = z.object({
  actorId: z.string().trim().min(1).max(64).optional(),
  /** Prefix match, e.g. "auth." or "order.mark_paid". */
  action: z.string().trim().min(1).max(100).optional(),
  entity: z.string().trim().min(1).max(64).optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().regex(/^\d{1,19}$/, "Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.input<typeof filterSchema>;

export type AuditEntry = {
  id: string;
  createdAt: Date;
  tenantId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  data: unknown;
  ip: string | null;
  actor: { id: string; email: string | null; name: string | null; role: Role | null; label: string } | null;
  summary: string;
};

export type AuditPage = { items: AuditEntry[]; nextCursor: string | null };

function buildWhere(q: z.output<typeof filterSchema>): Prisma.AuditLogWhereInput {
  return {
    ...(q.actorId ? { actorId: q.actorId } : {}),
    // Wildcards in the prefix can only widen the match within rows the viewer may already see.
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
  };
}

async function runQuery(
  where: Prisma.AuditLogWhereInput,
  limit: number,
  viewer: { role: Role },
): Promise<AuditPage> {
  const rows = await db.auditLog.findMany({
    where,
    orderBy: { id: "desc" },
    take: limit + 1,
    include: { actor: { select: { id: true, email: true, name: true, role: true } } },
  });
  const page = rows.slice(0, limit);
  const hideStaff = viewer.role !== "SUPERADMIN";

  const items = page.map((r): AuditEntry => {
    let actor: AuditEntry["actor"] = null;
    let ip = r.ip;
    if (r.actor) {
      const masked = hideStaff && r.actor.role === "SUPERADMIN";
      if (masked) ip = null;
      actor = masked
        ? { id: r.actor.id, email: null, name: null, role: r.actor.role, label: "Quartermaster staff" }
        : { ...r.actor, label: r.actor.name ? `${r.actor.name} <${r.actor.email}>` : r.actor.email };
    }
    const label = actor?.label ?? (r.actorId ? "Deleted user" : "Someone");
    return {
      id: r.id.toString(),
      createdAt: r.createdAt,
      tenantId: r.tenantId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      data: r.data,
      ip,
      actor,
      summary: summarizeAudit({ action: r.action, entity: r.entity, entityId: r.entityId, data: r.data, actorLabel: label }),
    };
  });
  return { items, nextCursor: rows.length > limit ? page[page.length - 1].id.toString() : null };
}

/** The tenant's audit log, newest first. Never returns rows of other tenants or platform rows. */
export async function queryAuditLog(ctx: ServiceContext, query: AuditQuery = {}): Promise<AuditPage> {
  if (!canAccessTenant(ctx.actor, ctx.tenantId)) throw new AuthError("FORBIDDEN");
  const q = parseInput(filterSchema, query);
  return runQuery({ ...buildWhere(q), tenantId: ctx.tenantId }, q.limit, ctx.actor);
}

const platformScopeSchema = z.object({
  /** "platform" = only tenantId NULL rows (default); "all" = every tenant too. */
  scope: z.enum(["platform", "all"]).default("platform"),
  tenantId: z.string().trim().min(1).max(64).optional(),
});

/** SUPERADMIN: platform-level audit entries (tenantId NULL), or everything with scope "all". */
export async function queryPlatformAuditLog(
  ctx: PlatformContext,
  query: AuditQuery & z.input<typeof platformScopeSchema> = {},
): Promise<AuditPage> {
  assertPlatformActor(ctx);
  const { scope, tenantId, ...rest } = query;
  const s = parseInput(platformScopeSchema, { scope, tenantId });
  const q = parseInput(filterSchema, rest);
  const tenantWhere: Prisma.AuditLogWhereInput =
    s.tenantId ? { tenantId: s.tenantId } : s.scope === "platform" ? { tenantId: null } : {};
  return runQuery({ ...buildWhere(q), ...tenantWhere }, q.limit, ctx.actor);
}
