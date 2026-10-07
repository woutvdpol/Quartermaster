"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionOk, formString, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import {
  createZone,
  deleteZone,
  listZones,
  quoteShipping,
  reorderZones,
  setZoneRates,
  updateZone,
  type QuoteResult,
  type RateInput,
} from "@/server/shipping";
import { fail, failFrom } from "../_system/errors";
import { parseKg } from "./_util";

const PATH = "/admin/shipping";

const rateRowSchema = z.object({
  maxWeightGrams: z.number().int(),
  price: z.number().int(),
  insurancePrice: z.number().int().nullable(),
  maxInsuredValue: z.number().int().nullable(),
});

function readRates(formData: FormData): RateInput[] | null {
  try {
    const parsed = z.array(rateRowSchema).safeParse(JSON.parse(formString(formData, "rates") || "[]"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Create or update a zone together with its weight tiers. */
export async function saveZoneAction(_prev: ActionState, formData: FormData): Promise<ActionResult<string, { id: string }>> {
  const id = formString(formData, "id");
  const name = formString(formData, "name");
  const rest = formData.get("restOfWorld") === "on";
  const countries = rest ? ["*"] : formData.getAll("countries").filter((c): c is string => typeof c === "string");
  const isPickup = formData.get("isPickup") === "on";
  const isActive = formData.get("isActive") === "on";
  const rates = readRates(formData);
  if (!rates) return fail("The weight tiers could not be read. Check each row has a weight and a price.");
  const missing: Record<string, string[]> = {};
  if (!name) missing.name = ["Enter a zone name."];
  rates.forEach((r, i) => {
    if (r.maxWeightGrams <= 0) missing[`rates.${i}.maxWeightGrams`] = ["Enter a weight above 0."];
    if (r.price < 0) missing[`rates.${i}.price`] = ["Enter a price (0 is allowed)."];
  });
  if (Object.keys(missing).length) return fail("Check the highlighted fields.", missing);

  try {
    const ctx = await requireStaffContext();
    let zoneId = id;
    if (id) {
      try {
        await updateZone(ctx, id, { name, countries, isPickup, isActive });
      } catch (err) {
        return failFrom(err);
      }
      try {
        await setZoneRates(ctx, id, rates);
      } catch (err) {
        revalidatePath(PATH);
        const failure = failFrom(err, { fieldPrefix: "rates" });
        return fail(`Zone details saved, but the weight tiers were not: ${failure.message ?? ""}`.trim(), failure.fieldErrors);
      }
    } else {
      const zone = await createZone(ctx, { name, countries, isPickup, isActive, rates });
      zoneId = zone.id;
    }
    revalidatePath(PATH);
    return actionOk(id ? `Zone “${name}” saved.` : `Zone “${name}” created.`, { id: zoneId });
  } catch (err) {
    return failFrom(err);
  }
}

export async function deleteZoneAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await deleteZone(ctx, formString(formData, "id"));
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk("Zone deleted.");
}

/** Moves a zone one place up or down in the display order. */
export async function moveZoneAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    const ids = (await listZones(ctx)).map((z) => z.id);
    const i = ids.indexOf(id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0) return fail("This zone no longer exists. Reload the page.");
    if (j < 0 || j >= ids.length) return actionOk();
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderZones(ctx, ids);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk();
}

const quoteSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/, "Choose a country."),
  weight: z.number({ message: "Enter a weight in kg." }).int().min(0).max(100_000_000),
  subtotal: z.number({ message: "Enter an amount." }).int().min(0),
});

export type QuoteTestResult = QuoteResult & { freeShippingThreshold: number };

/** Runs the real checkout quote for the current shop (read-only). */
export async function testQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionResult<string, QuoteTestResult>> {
  const weight = parseKg(formString(formData, "weightKg"));
  const subtotalRaw = formString(formData, "subtotal");
  const parsed = quoteSchema.safeParse({
    countryCode: formString(formData, "countryCode"),
    weight: weight ?? undefined,
    subtotal: subtotalRaw === "" ? 0 : Number(subtotalRaw),
  });
  if (!parsed.success) {
    const fe = zodFieldErrors(parsed.error);
    if (fe.weight) fe.weightKg = fe.weight;
    return fail("Check the highlighted fields.", fe);
  }
  try {
    const ctx = await requireStaffContext();
    const applyThreshold = formData.get("applyFreeShipping") === "on";
    const threshold = applyThreshold ? (await getSettings(ctx.tenantId, "checkout")).freeShippingThresholdCents : 0;
    const result = await quoteShipping(ctx.tenantId, {
      countryCode: parsed.data.countryCode,
      totalWeightGrams: parsed.data.weight,
      subtotal: parsed.data.subtotal,
      freeShippingThreshold: threshold || null,
    });
    return actionOk(undefined, { ...result, freeShippingThreshold: threshold });
  } catch (err) {
    return failFrom(err);
  }
}
