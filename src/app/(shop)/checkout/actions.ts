"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
// Not while the shop is "coming soon" (src/server/storefront/launch.ts).
import { getOpenShopTenant as getRequestTenant } from "@/server/storefront/launch";
import { clientIp } from "@/server/customer-auth/current";
import { take } from "@/server/auth/rate-limit";
import { getShopViewer } from "@/server/cart";
import { readCartToken } from "@/server/cart/cookie";
import { placeOrder, quoteCheckout, startOrderPayment, type CheckoutQuote, type FieldErrors } from "@/server/checkout";
import { formDataToObject } from "@/server/checkout/schema";
import { orderStatusPath } from "@/server/checkout/urls";
import { getRequestLocale } from "@/server/i18n/locale";
import { localizePath } from "@/lib/i18n/shop-locales";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { cartCopies } from "@/components/shop/cart/_copy";
import { localizeFieldErrors, localizeServerMessage } from "@/components/shop/cart/server-messages";

/*
 * Checkout server actions. Money, zone and availability are decided by src/server/checkout — the form
 * only names a country, a shipping option id and a payment method.
 */

const PLACE_RULE = { limit: 20, windowMs: 15 * 60 * 1000 };

export type CheckoutFormState = {
  status: "idle" | "error" | "placed";
  /** status "placed": app path to navigate to client-side (see below). */
  redirectTo?: string;
  message?: string;
  code?: string;
  errors?: FieldErrors;
  /** Submitted text values, so the form keeps them after an error (also without JS). */
  values?: Record<string, unknown>;
  blockedProductIds?: string[];
};

async function tenantId(): Promise<string> {
  const tenant = await getRequestTenant();
  if (!tenant) throw new Error("No shop on this host");
  return tenant.id;
}

export async function placeOrderAction(_prev: CheckoutFormState, form: FormData): Promise<CheckoutFormState> {
  const tid = await tenantId();
  const locale = await getRequestLocale();
  const t = pickCopy(cartCopies, locale).checkout;
  const raw = formDataToObject(form);
  const ipKey = `checkout.place:${tid}:${(await clientIp()) ?? "unknown"}`;
  if (!(await take(ipKey, PLACE_RULE))) {
    return { status: "error", code: "RATE_LIMITED", message: t.rateLimited, values: raw };
  }

  let destination: string;
  try {
    const viewer = await getShopViewer(tid);
    const result = await placeOrder(tid, await readCartToken(), raw, viewer);
    if (!result.ok) {
      return {
        status: "error",
        code: result.code,
        message: localizeServerMessage(result.message, locale),
        errors: localizeFieldErrors(result.errors, locale),
        values: raw,
        blockedProductIds: result.blockedProductIds,
      };
    }
    const host = (await headers()).get("host") ?? "";
    const start = await startOrderPayment(tid, result.orderId, { host });
    // Mollie redirect URLs stay as they are; the order page opens in the visitor's language.
    destination = start.kind === "redirect" ? start.url : localizePath(orderStatusPath(result.uuid), locale);
  } catch (err) {
    console.error("[checkout] placing order failed", err instanceof Error ? err.message : err);
    return { status: "error", code: "ERROR", message: t.unexpected, values: raw };
  }
  // External (Mollie) → redirect. An app path is returned instead: redirecting to an app path from a
  // JS-invoked action renders it through an internal fetch to the server's own origin, which loses the
  // shop host and 404s. The form navigates client-side (and shows a link as no-JS fallback).
  if (/^https?:\/\//.test(destination)) redirect(destination);
  return { status: "placed", redirectTo: destination };
}

/** Totals + shipping options for the address country (re-run on every country/option/payment-method change). */
export async function checkoutQuoteAction(input: {
  countryCode?: unknown;
  shippingOptionId?: unknown;
  insurance?: unknown;
  paymentMethod?: unknown;
}): Promise<CheckoutQuote | null> {
  const country = typeof input?.countryCode === "string" ? input.countryCode : "";
  if (!/^[A-Za-z]{2}$/.test(country)) return null;
  const tid = await tenantId();
  return quoteCheckout(tid, await readCartToken(), {
    countryCode: country,
    shippingOptionId: typeof input.shippingOptionId === "string" ? input.shippingOptionId.slice(0, 64) : null,
    insurance: input.insurance === true,
    paymentMethod: typeof input.paymentMethod === "string" && /^[a-z0-9]{1,40}$/.test(input.paymentMethod) ? input.paymentMethod : null,
  });
}
