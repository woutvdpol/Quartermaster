"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { ServiceError } from "@/server/context";
import { subscribe } from "@/server/newsletter";
import * as rateLimit from "@/server/auth/rate-limit";
import { clientIp } from "@/server/analytics/collect";
import { getShopContext } from "@/server/storefront/context";

export type NewsletterState = { status: "idle" | "success" | "invalid" | "unavailable" | "too_many"; email?: string };

/** Per IP and shop: sign-up attempts per hour (the service also limits per address). */
const PER_IP = { limit: 10, windowMs: 60 * 60 * 1000 };

const input = z.object({
  email: z.string().trim().max(254),
  // Honeypot: real visitors never see or fill this field.
  website: z.string().max(500).optional().default(""),
  source: z.enum(["footer", "block", "popup"]).catch("footer"),
});

/**
 * Newsletter sign-up for the storefront (double opt-in via `subscribe`). Always answers with the
 * same neutral success for valid input, so it never reveals whether an address is subscribed.
 * TODO(turnstile): add a Turnstile check here once keys are configured.
 */
export async function subscribeNewsletter(_prev: NewsletterState, form: FormData): Promise<NewsletterState> {
  const shop = await getShopContext();
  if (!shop || !shop.settings.features.newsletter) return { status: "unavailable" };
  const parsed = input.safeParse({ email: form.get("email"), website: form.get("website") ?? "", source: form.get("source") });
  if (!parsed.success) return { status: "invalid" };
  const { email, website, source } = parsed.data;
  if (website) return { status: "success" }; // bot: pretend it worked

  const ip = clientIp(await headers()) ?? "unknown";
  const key = `shop.newsletter.ip:${shop.tenant.id}:${ip}`;
  if (await rateLimit.isLimited(key, PER_IP)) return { status: "too_many", email };
  await rateLimit.hit(key);

  try {
    const result = await subscribe(shop.tenant.id, email, { source });
    if (result.status === "rate_limited") return { status: "too_many", email };
    return { status: "success" };
  } catch (err) {
    if (err instanceof ServiceError && err.code === "INVALID") return { status: "invalid", email };
    if (err instanceof ServiceError) return { status: "unavailable", email };
    console.error("[shop] newsletter sign-up failed", err);
    return { status: "unavailable", email };
  }
}
