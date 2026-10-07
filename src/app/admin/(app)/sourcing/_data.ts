import "server-only";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";

/*
 * Local read (gap in src/server/purchasing): listPurchaseRecords has no allocated cost per record.
 * Σ Product.purchasePrice per record for the given record ids, tenant-scoped.
 */
export async function allocatedCostByRecord(ctx: ServiceContext, recordIds: string[]): Promise<Map<string, number>> {
  if (recordIds.length === 0) return new Map();
  const rows = await db.product.groupBy({
    by: ["purchaseRecordId"],
    where: { tenantId: ctx.tenantId, purchaseRecordId: { in: recordIds } },
    _sum: { purchasePrice: true },
  });
  return new Map(rows.map((r) => [r.purchaseRecordId as string, r._sum.purchasePrice ?? 0]));
}
