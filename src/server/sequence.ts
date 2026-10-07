import "server-only";
import type { Prisma } from "@/generated/prisma/client";

export type SequenceName = "product.stockCode" | "order.number" | "invoice.number";

// First value issued for a fresh tenant.
const START: Record<SequenceName, number> = {
  "product.stockCode": 50000,
  "order.number": 1,
  "invoice.number": 1,
};

/**
 * Issues the next per-tenant number. Must run inside the business transaction (`tx`) so a
 * rollback leaves no gap; the row lock serialises concurrent issuers for the same tenant.
 */
export async function nextSequenceValue(tx: Prisma.TransactionClient, tenantId: string, name: SequenceName): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO tenant_sequences ("tenantId", name, value, "updatedAt")
    VALUES (${tenantId}, ${name}, ${START[name]}, now())
    ON CONFLICT ("tenantId", name)
    DO UPDATE SET value = tenant_sequences.value + 1, "updatedAt" = now()
    RETURNING value`;
  return rows[0].value;
}
