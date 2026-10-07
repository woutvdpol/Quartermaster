import "server-only";
import { db } from "@/server/db";

/*
 * Tenant isolation, defence in depth (security backlog #11).
 *
 * Layer 1 (primary, unchanged): every service takes a ServiceContext and filters/writes with
 * `ctx.tenantId` explicitly.
 * Layer 2 (this file): `tenantDb(tenantId)` — a Prisma client extension that rewrites every query
 * on a tenant-scoped model so it can only see and touch rows of that tenant:
 *   - reads / updates / deletes (incl. findUnique & update by id): `where.tenantId` is forced to
 *     the tenant, so a foreign id simply isn't found (null / P2025 / count 0);
 *   - creates / upserts: `data.tenantId` is filled in, a different value throws;
 *   - updates may not move a row to another tenant (`data.tenantId` ≠ tenant throws);
 *   - a `where.tenantId` filter for another tenant, or a non-literal one ({ in: … }), throws.
 * A violation throws TenantScopeError — always a programming error, never user input.
 *
 * Limits (documented in docs/04-security-review.md):
 *   - top-level queries only: nested writes (`lines: { create: … }`), relation filters and
 *     `include`d relations are not rewritten (FKs keep children with their parent, but a relation
 *     to a row of another tenant — e.g. OrderLine.productId — is not prevented by the schema);
 *   - raw SQL ($queryRaw / $executeRaw) is not covered;
 *   - only code that uses `tenantDb()` is protected; services migrate to it gradually. It is used
 *     by the order read queries and the customers service; the integration test
 *     tests/integration/tenant-isolation.int.test.ts proves cross-tenant reads/writes fail for
 *     products, orders, customers, pages and redirects at service level and through tenantDb.
 *   - User and AuditLog have a nullable tenantId (platform rows) and are NOT scoped here.
 */

/** Models with a required `tenantId` (kept in sync with prisma/schema.prisma by a unit test). */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  "TenantDomain", "Setting", "TenantSequence", "Category", "Tag", "Product", "ProductImage", "ProductTag",
  "ProductRelation", "Supplier", "PurchaseRecord", "StockMovement", "Customer", "Address", "WishlistItem",
  "Cart", "CartItem", "Reservation", "Order", "OrderLine", "OrderAddress", "OrderEvent", "Payment", "Invoice",
  "ShippingZone", "ShippingRate", "ContentPage", "ContentBlock", "MenuItem", "NewsletterSubscriber",
  "NewsletterCampaign", "PageView", "Facet", "FacetValue", "ProductFacetValue", "SavedSearch", "AlertDelivery",
  "ProductDocument", "Certificate", "ComplianceRule", "Offer", "Coupon", "CouponRedemption", "Lead", "Redirect",
]);

export class TenantScopeError extends Error {
  constructor(model: string, operation: string, reason: string) {
    super(`Tenant scope violation on ${model}.${operation}: ${reason}`);
    this.name = "TenantScopeError";
  }
}

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown };

const WHERE_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
  "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATE_DATA_OPS = new Set(["update", "updateMany", "updateManyAndReturn"]);

function scopeWhere(model: string, op: string, where: Record<string, unknown> | undefined, tenantId: string) {
  const w = { ...(where ?? {}) };
  if ("tenantId" in w && w.tenantId !== undefined && w.tenantId !== tenantId) {
    throw new TenantScopeError(model, op, typeof w.tenantId === "string" ? "where.tenantId is another tenant" : "where.tenantId must be a literal");
  }
  w.tenantId = tenantId;
  return w;
}

function scopeCreateData(model: string, op: string, data: unknown, tenantId: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TenantScopeError(model, op, "data must be an object");
  const d = { ...(data as Record<string, unknown>) };
  if ("tenant" in d) throw new TenantScopeError(model, op, "use tenantId, not a tenant relation");
  if (d.tenantId !== undefined && d.tenantId !== tenantId) throw new TenantScopeError(model, op, "data.tenantId is another tenant");
  d.tenantId = tenantId;
  return d;
}

function assertNoTenantMove(model: string, op: string, data: unknown, tenantId: string) {
  if (!data || typeof data !== "object") return;
  const d = data as Record<string, unknown>;
  if ("tenant" in d) throw new TenantScopeError(model, op, "cannot change the tenant relation");
  if (d.tenantId !== undefined && d.tenantId !== tenantId) throw new TenantScopeError(model, op, "cannot move a row to another tenant");
}

/** Pure rewrite of one query's arguments (exported for unit tests). */
export function scopeArgs(model: string, operation: string, args: Args | undefined, tenantId: string): Args | undefined {
  if (!TENANT_SCOPED_MODELS.has(model)) return args;
  const out: Args = { ...(args ?? {}) };
  if (WHERE_OPS.has(operation)) out.where = scopeWhere(model, operation, out.where, tenantId);
  if (CREATE_OPS.has(operation)) {
    out.data = Array.isArray(out.data)
      ? out.data.map((row) => scopeCreateData(model, operation, row, tenantId))
      : operation === "create"
        ? scopeCreateData(model, operation, out.data, tenantId)
        : [scopeCreateData(model, operation, out.data, tenantId)];
  }
  if (UPDATE_DATA_OPS.has(operation)) assertNoTenantMove(model, operation, out.data, tenantId);
  if (operation === "upsert") {
    out.create = scopeCreateData(model, operation, out.create, tenantId);
    assertNoTenantMove(model, operation, out.update, tenantId);
  }
  if (!WHERE_OPS.has(operation) && !CREATE_OPS.has(operation)) {
    throw new TenantScopeError(model, operation, "unsupported operation in a tenant-scoped client");
  }
  return out;
}

function createTenantClient(tenantId: string) {
  return db.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, tenantId) as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof createTenantClient>;

/**
 * A Prisma client (and, via `$transaction(async (tx) => …)`, transaction client) that can only
 * read and write rows of `tenantId` on tenant-scoped models. Use it in service code instead of `db`.
 */
export function tenantDb(tenantId: string): TenantDb {
  if (typeof tenantId !== "string" || tenantId.length === 0) throw new TenantScopeError("*", "tenantDb", "missing tenantId");
  return createTenantClient(tenantId);
}
