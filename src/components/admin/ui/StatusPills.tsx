import type { FulfillmentStatus, PaymentStatus, ProductStatus } from "@/generated/prisma/enums";
import { getDictionary } from "@/lib/i18n";
import { StatusPill, type StatusTone } from "../StatusPill";

const t = getDictionary().ui.status;

/*
 * Status → tone mapping for the domain enums, so every screen colours statuses the same way.
 * Labels come from the i18n dictionary (ui.status.*).
 */

export const PRODUCT_STATUS_TONE: Record<ProductStatus, StatusTone> = {
  DRAFT: "mute",
  ACTIVE: "ok",
  RESERVED: "warn",
  SOLD: "info",
  ARCHIVED: "mute",
  STOLEN: "crit",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, StatusTone> = {
  PENDING: "warn",
  PAID: "ok",
  FAILED: "crit",
  CANCELED: "mute",
  EXPIRED: "mute",
  REFUNDED: "info",
  PARTIALLY_REFUNDED: "info",
};

export const FULFILLMENT_STATUS_TONE: Record<FulfillmentStatus, StatusTone> = {
  UNFULFILLED: "warn",
  PACKED: "info",
  SHIPPED: "info",
  DELIVERED: "ok",
};

export const productStatusLabel = (s: ProductStatus): string => t.product[s];
export const paymentStatusLabel = (s: PaymentStatus): string => t.payment[s];
export const fulfillmentStatusLabel = (s: FulfillmentStatus): string => t.fulfillment[s];

export function ProductStatusPill({ status }: { status: ProductStatus }) {
  return <StatusPill tone={PRODUCT_STATUS_TONE[status]}>{t.product[status]}</StatusPill>;
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return <StatusPill tone={PAYMENT_STATUS_TONE[status]}>{t.payment[status]}</StatusPill>;
}

export function FulfillmentStatusPill({ status }: { status: FulfillmentStatus }) {
  return <StatusPill tone={FULFILLMENT_STATUS_TONE[status]}>{t.fulfillment[status]}</StatusPill>;
}
