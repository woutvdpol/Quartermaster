import { z } from "zod";

/**
 * Props of the alert mail templates (spread into MAIL_TEMPLATE_PROPS in src/server/mail/contracts.ts).
 * Pure zod, no server imports. Props carry ids; the builders (./mail.tsx) load fresh data at send time.
 */
const id = z.string().min(1).max(64);

/** Max products referenced by one new-arrivals mail. */
export const MAX_DIGEST_DELIVERIES = 200;

export const ALERT_MAIL_PROPS = {
  /** Double opt-in for a guest's saved search. */
  "alert-confirm": z.object({ savedSearchId: id, tokenEnc: z.string().min(1) }),
  /** INSTANT (one delivery) or DAILY/WEEKLY digest (many) for one saved search. */
  "alert-new-arrivals": z.object({ savedSearchId: id, deliveryIds: z.array(id).min(1).max(MAX_DIGEST_DELIVERIES) }),
  /** A wishlisted item is free again (reservation released / expired). */
  "alert-back-available": z.object({ customerId: id, productId: id }),
  /** A wishlisted item got cheaper. Prices in minor units at the time of the change. */
  "alert-price-drop": z.object({ customerId: id, productId: id, oldPrice: z.number().int().min(0), newPrice: z.number().int().min(0) }),
} as const;
