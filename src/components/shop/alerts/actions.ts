"use server";

import { verifyTurnstile } from "@/server/turnstile";
import { z } from "zod";
import { ServiceError } from "@/server/context";
import { clientIp, getShopCustomer } from "@/server/customer-auth";
// Not while the shop is "coming soon" (src/server/storefront/launch.ts).
import { getOpenShopTenant as getRequestTenant } from "@/server/storefront/launch";
import {
  createSavedSearch,
  describeQuery,
  queryFromCatalogInput,
  suggestedQueryForProduct,
  summarizeDescription,
  type SavedSearchQuery,
} from "@/server/alerts";

/*
 * Server actions behind <NotifyMeButton> and <SaveSearchButton>. The tenant comes from the request
 * host and the customer from the session — never from the client.
 */

export type AlertDialogState = {
  loggedIn: boolean;
  email: string | null;
  defaultName: string;
  summary: string;
};

const idSchema = z.string().min(1).max(64);

const catalogInputSchema = z
  .object({
    q: z.string().max(200).nullish(),
    categoryId: idSchema.nullish(),
    tags: z.array(z.string().max(120)).max(20).optional(),
    tagIds: z.array(idSchema).max(20).optional(),
    facetValueIds: z.array(idSchema).max(20).optional(),
    min: z.number().nonnegative().nullish(),
    max: z.number().nonnegative().nullish(),
  })
  .loose();

async function resolveInput(tenantId: string, source: unknown): Promise<SavedSearchQuery> {
  const s = z.union([z.object({ productId: idSchema }), z.object({ query: catalogInputSchema })]).safeParse(source);
  if (!s.success) throw new ServiceError("INVALID", "Invalid search");
  if ("productId" in s.data) return suggestedQueryForProduct(tenantId, s.data.productId);
  return queryFromCatalogInput(tenantId, s.data.query);
}

/** Loaded when the dialog opens: who is the visitor (prefill email) and what will be saved. */
export async function getAlertDialogStateAction(source: unknown): Promise<AlertDialogState> {
  const tenant = await getRequestTenant();
  if (!tenant) return { loggedIn: false, email: null, defaultName: "", summary: "" };
  const [customer, query] = await Promise.all([getShopCustomer(), resolveInput(tenant.id, source).catch(() => null)]);
  const summary = query ? summarizeDescription(await describeQuery(tenant.id, query)) : "";
  return {
    loggedIn: !!customer,
    email: customer?.user.email ?? null, // the login address (Customer.email may be a placeholder until verified)
    defaultName: summary.slice(0, 120),
    summary,
  };
}

export type CreateAlertResult = { status: "created" | "pending" | "duplicate" | "limit" | "rate_limited" | "invalid" | "captcha" | "error"; message?: string };

export async function createAlertAction(input: unknown): Promise<CreateAlertResult> {
  const parsed = z
    .object({
      source: z.unknown(),
      name: z.string().max(120).optional(),
      email: z.string().max(254).optional(),
      frequency: z.enum(["INSTANT", "DAILY", "WEEKLY"]).optional(),
      website: z.string().max(200).optional(), // honeypot
      turnstileToken: z.string().max(4096).nullish(),
    })
    .safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const tenant = await getRequestTenant();
  if (!tenant) return { status: "error" };
  if (parsed.data.website) return { status: "pending" }; // bots: pretend success
  try {
    const [customer, query, ip] = await Promise.all([getShopCustomer(), resolveInput(tenant.id, parsed.data.source), clientIp()]);
    const captcha = await verifyTurnstile(parsed.data.turnstileToken ?? null, ip, { action: "alert" });
    if (!captcha.ok) return { status: "captcha" };
    const res = await createSavedSearch(
      tenant.id,
      {
        customerId: customer?.customer.id ?? null,
        email: parsed.data.email ?? null,
        name: parsed.data.name ?? null,
        query,
        frequency: parsed.data.frequency,
      },
      { ip },
    );
    return { status: res.status };
  } catch (err) {
    if (err instanceof ServiceError && err.code === "INVALID") return { status: "invalid", message: err.message };
    console.error("createAlertAction failed", err);
    return { status: "error" };
  }
}
