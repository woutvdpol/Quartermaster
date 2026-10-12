"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getOpenShopTenant } from "@/server/storefront/launch";
import { clientIp } from "@/server/customer-auth/current";
import { take } from "@/server/auth/rate-limit";
import { getAuctionPayView, quoteAuctionPayment, submitAuctionPayment } from "@/server/auctions/pay";
import { startOrderPayment, type CheckoutQuote, type FieldErrors } from "@/server/checkout";
import { formDataToObject } from "@/server/checkout/schema";
import { orderStatusPath } from "@/server/checkout/urls";
import { getRequestLocale } from "@/server/i18n/locale";
import { localizePath } from "@/lib/i18n/shop-locales";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { localizeFieldErrors, localizeServerMessage } from "@/components/shop/cart/server-messages";
import { auctionCopies } from "@/components/shop/auctions/_copy";
import { cartCopies } from "@/components/shop/cart/_copy";
import { payAccess } from "../_owner";

/*
 * Winner's payment page actions. Delivery, totals and state are decided by src/server/auctions/pay.ts
 * (submitAuctionPayment writes them onto the lot's order); the payment starts like any checkout
 * (startOrderPayment → Mollie, or the order page in dev simulation).
 */

const PAY_RULE = { limit: 20, windowMs: 15 * 60 * 1000 };
const TOKEN = /^[A-Za-z0-9._-]{10,120}$/;

export type AuctionPayFormState = {
  status: "idle" | "error" | "placed";
  redirectTo?: string;
  message?: string;
  code?: string;
  errors?: FieldErrors;
  values?: Record<string, unknown>;
};

async function tenantId(): Promise<string | null> {
  return (await getOpenShopTenant())?.id ?? null;
}

export async function payAuctionAction(token: string, _prev: AuctionPayFormState, form: FormData): Promise<AuctionPayFormState> {
  const locale = await getRequestLocale();
  const t = pickCopy(auctionCopies, locale).pay;
  const raw = formDataToObject(form);
  const tid = await tenantId();
  if (!tid || typeof token !== "string" || !TOKEN.test(token)) return { status: "error", code: "NOT_FOUND", message: t.invalidTitle, values: raw };
  if (!(await take(`auction.pay:${tid}:${(await clientIp()) ?? "unknown"}`, PAY_RULE))) {
    return { status: "error", code: "RATE_LIMITED", message: pickCopy(cartCopies, locale).checkout.rateLimited, values: raw };
  }
  let destination: string;
  try {
    const view = await getAuctionPayView(tid, token);
    if (!view) return { status: "error", code: "NOT_FOUND", message: t.invalidTitle, values: raw };
    if ((await payAccess(tid, view.lot.id)) !== "ok") return { status: "error", code: "WRONG_ACCOUNT", message: t.wrongAccountTitle, values: raw };
    const result = await submitAuctionPayment(tid, token, raw);
    if (!result.ok) {
      if (result.code === "PAID" || result.code === "PROCESSING") {
        return { status: "placed", redirectTo: localizePath(orderStatusPath(view.order.uuid), locale) };
      }
      return { status: "error", code: result.code, message: localizeServerMessage(result.message, locale), errors: localizeFieldErrors(result.errors, locale), values: raw };
    }
    const host = (await headers()).get("host") ?? "";
    const start = await startOrderPayment(tid, result.orderId, { host });
    destination = start.kind === "redirect" ? start.url : localizePath(orderStatusPath(result.uuid), locale);
  } catch (err) {
    console.error("[auctions] winner payment failed", err instanceof Error ? err.message : err);
    return { status: "error", code: "ERROR", message: t.unexpected, values: raw };
  }
  // Same as checkout: external (Mollie) → redirect; an app path is navigated to client-side.
  if (/^https?:\/\//.test(destination)) redirect(destination);
  return { status: "placed", redirectTo: destination };
}

/** Shipping options + totals for a country (re-run on country / option / insurance / method change). */
export async function auctionPayQuoteAction(
  token: string,
  input: { countryCode?: unknown; shippingOptionId?: unknown; insurance?: unknown; paymentMethod?: unknown },
): Promise<CheckoutQuote | null> {
  const country = typeof input?.countryCode === "string" ? input.countryCode : "";
  if (!/^[A-Za-z]{2}$/.test(country) || typeof token !== "string" || !TOKEN.test(token)) return null;
  const tid = await tenantId();
  if (!tid) return null;
  try {
    return await quoteAuctionPayment(tid, token, {
      countryCode: country,
      shippingOptionId: typeof input.shippingOptionId === "string" ? input.shippingOptionId.slice(0, 64) : null,
      insurance: input.insurance === true,
      paymentMethod: typeof input.paymentMethod === "string" && /^[a-z0-9]{1,40}$/.test(input.paymentMethod) ? input.paymentMethod : null,
    });
  } catch {
    return null;
  }
}
