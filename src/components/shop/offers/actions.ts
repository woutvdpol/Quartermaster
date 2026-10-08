"use server";

import { revalidatePath } from "next/cache";
// Not while the shop is "coming soon" (src/server/storefront/launch.ts).
import { getOpenShopTenant as getRequestTenant } from "@/server/storefront/launch";
import { clientIp } from "@/server/customer-auth/current";
import { take } from "@/server/auth/rate-limit";
import { getShopViewer } from "@/server/cart";
import { readCartToken, writeCartToken } from "@/server/cart/cookie";
import { buyOffer, respondToCounter, submitOffer, OFFER_PATHS } from "@/server/offers";
import { turnstileTokenFrom, verifyTurnstile } from "@/server/turnstile";

/*
 * Offer flow server actions (product page dialog, /offer/<token>, /offer/counter/<token>).
 * Tenant from the request host; amounts parsed here into minor units, everything else is validated
 * by src/server/offers.
 */

async function requireTenantId(): Promise<string> {
  const tenant = await getRequestTenant();
  if (!tenant) throw new Error("No shop on this host");
  return tenant.id;
}

/** "85", "85.5", "85,50", "1.250,00", "€ 85" → minor units; null when unreadable. */
function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
    s = s.slice(0, lastSep).replace(/[.,]/g, "") + "." + s.slice(lastSep + 1);
  } else {
    s = s.replace(/[.,]/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return null;
  return Math.round(n * 100);
}

export type OfferFormState = { ok: true; message: string } | { ok: false; message: string; errors?: Record<string, string>; values?: Record<string, string> } | null;

export async function submitOfferAction(_prev: OfferFormState, form: FormData): Promise<OfferFormState> {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const values = { name: str("name"), email: str("email"), amount: str("amount"), message: str("message") };
  const amount = parseAmount(values.amount);
  if (amount === null) return { ok: false, message: "Please check the highlighted fields", errors: { amount: "Enter an amount like 85 or 85.50" }, values };
  try {
    const tenantId = await requireTenantId();
    const ip = await clientIp();
    const captcha = await verifyTurnstile(turnstileTokenFrom(form), ip, { action: "offer" });
    if (!captcha.ok) return { ok: false, message: "We could not verify that you are human. Please try again.", values };
    const viewer = await getShopViewer(tenantId);
    const res = await submitOffer(
      tenantId,
      {
        productId: str("productId").slice(0, 64),
        email: viewer?.email ?? values.email,
        name: values.name,
        amount,
        message: values.message,
        customerId: viewer?.customerId ?? null,
        website: str("website"),
      },
      { ip },
    );
    if (res.ok) return { ok: true, message: "sent" };
    return { ok: false, message: res.message, errors: res.errors, values };
  } catch (err) {
    console.error("[offers] submit failed", err instanceof Error ? err.message : err);
    return { ok: false, message: "Something went wrong. Please try again.", values };
  }
}

const BUY_RULE = { limit: 30, windowMs: 10 * 60 * 1000 };

/** "Buy now" on the personal offer page. Returns the next path (client navigates — see cart actions). */
export async function buyOfferAction(token: unknown): Promise<{ ok: true; redirectTo: string } | { ok: false; message: string }> {
  if (typeof token !== "string" || token.length > 120) return { ok: false, message: "This offer link is no longer valid" };
  const tenantId = await requireTenantId();
  const key = `offer.buy:${tenantId}:${(await clientIp()) ?? "unknown"}`;
  if (!(await take(key, BUY_RULE))) return { ok: false, message: "Too many attempts. Please wait a moment." };
  const viewer = await getShopViewer(tenantId);
  const { token: newCartToken, result } = await buyOffer(tenantId, token, await readCartToken(), viewer);
  if (newCartToken) await writeCartToken(newCartToken);
  revalidatePath("/cart");
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, redirectTo: "/checkout" };
}

/** Accept / decline a counter offer. Accept → straight to the personal checkout page. */
export async function respondToCounterAction(token: unknown, decision: unknown): Promise<{ ok: true; redirectTo: string | null } | { ok: false; message: string }> {
  if (typeof token !== "string" || token.length > 120 || (decision !== "accept" && decision !== "decline")) return { ok: false, message: "This link is no longer valid" };
  const tenantId = await requireTenantId();
  const key = `offer.counter:${tenantId}:${(await clientIp()) ?? "unknown"}`;
  if (!(await take(key, BUY_RULE))) return { ok: false, message: "Too many attempts. Please wait a moment." };
  const res = await respondToCounter(tenantId, token, decision);
  if (!res.ok) return res;
  revalidatePath(OFFER_PATHS.counter(token));
  return { ok: true, redirectTo: res.decision === "accept" ? OFFER_PATHS.checkout(res.checkoutToken) : null };
}
