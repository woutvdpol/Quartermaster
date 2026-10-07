import type { ProductStatus } from "../../../src/generated/prisma/enums";

/**
 * Concept500 never stored a product status; `ProductStatusService` derived it at runtime from
 * `active` (ACTIVE|INACTIVE|ARCHIVED), `stock_control` (RESERVED|SOLD|STOLEN|NOT_IN_SHOP) and
 * `quantity`, with priority ARCHIVED → SOLD → STOLEN → RESERVED → ACTIVE (docs/analysis/02 §4).
 *
 * Quartermaster stores one status (decision 11). Mapping:
 *  - active ARCHIVED                          → ARCHIVED
 *  - active INACTIVE                          → DRAFT (was never visible in the shop)
 *  - quantity 0 + stock_control SOLD          → SOLD
 *  - quantity 0 + stock_control STOLEN        → STOLEN
 *  - quantity 0 + stock_control RESERVED      → RESERVED ("show as reserved when sold out" — legacy shop
 *                                               showed these as Reserved; kept for display parity)
 *  - quantity 0 + stock_control NOT_IN_SHOP   → ARCHIVED (legacy hid them from every listing and
 *                                               redirected the product page away)
 *  - otherwise (active ACTIVE, quantity > 0)  → ACTIVE
 * The short-lived "recently reserved" state (`product_reserved_on` within `reserved_time`) is a cart
 * hold, not a status: it is ignored here and kept in legacyData.
 */
export type LegacyStatusInput = { active: string; stockControl: string; quantity: number };

export function deriveProductStatus(p: LegacyStatusInput): ProductStatus {
  const active = (p.active ?? "").trim().toUpperCase();
  const control = (p.stockControl ?? "").trim().toUpperCase();
  if (active === "ARCHIVED") return "ARCHIVED";
  if (active !== "ACTIVE") return "DRAFT";
  if (p.quantity <= 0) {
    switch (control) {
      case "SOLD":
        return "SOLD";
      case "STOLEN":
        return "STOLEN";
      case "NOT_IN_SHOP":
        return "ARCHIVED";
      default:
        return "RESERVED";
    }
  }
  return "ACTIVE";
}
