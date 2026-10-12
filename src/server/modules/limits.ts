import "server-only";
import { ServiceError } from "@/server/context";
import type { db } from "@/server/db";
import { getEntitlements } from "./index";

type ProductCounter = Pick<typeof db, "product">;

/**
 * Package product limit (docs/modules.md): counts products that are for sale (ACTIVE, in stock), as
 * Concept500 did. Drafts never count, so a shop can always prepare products; making `adding` more
 * products for sale is refused when that would exceed the limit. Existing products are never taken
 * offline by a lower limit. Call inside the transaction that activates the products.
 */
export async function assertProductCapacity(tx: ProductCounter, tenantId: string, adding: number): Promise<void> {
  if (adding <= 0) return;
  const { limits } = await getEntitlements(tenantId);
  if (limits.productLimit === null) return;
  const forSale = await tx.product.count({ where: { tenantId, status: "ACTIVE", quantity: { gt: 0 } } });
  if (forSale + adding <= limits.productLimit) return;
  throw new ServiceError(
    "UNAVAILABLE",
    `Your package allows ${limits.productLimit} products for sale (${forSale} now). Upgrade your package or add extra products to put more up for sale.`,
    { limit: "products", max: limits.productLimit, current: forSale },
  );
}
