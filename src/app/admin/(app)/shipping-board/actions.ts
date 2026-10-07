"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, formString, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { updateFulfillment } from "@/server/fulfillment";
import { failFromError } from "../orders/_lib/errors";
import { boardCopy as t } from "./_copy";

function revalidateBoard(id: string) {
  revalidatePath("/admin/shipping-board");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
}

const moveSchema = z.object({
  id: z.string().trim().min(1).max(64),
  number: z.coerce.number().int().positive(),
  to: z.enum(["UNFULFILLED", "PACKED", "DELIVERED"]),
});

/** Moves a card between lanes (not into Shipped — that needs the ship form). */
export async function moveOrderAction(input: { id: string; number: number; to: "UNFULFILLED" | "PACKED" | "DELIVERED" }): Promise<ActionResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return actionFail(t.notFound);
  const { id, number, to } = parsed.data;
  try {
    const ctx = await requireStaffContext();
    await updateFulfillment(ctx, id, { status: to, notifyCustomer: false });
    revalidateBoard(id);
    return actionOk(t.moved[to](number));
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}

const shipSchema = z.object({
  id: z.string().trim().min(1).max(64),
  number: z.coerce.number().int().positive(),
  carrier: z.string().trim().max(100, "Keep the carrier under 100 characters."),
  trackingNumber: z.string().trim().max(200, "Keep the tracking code under 200 characters."),
  trackingUrl: z.union([
    z.literal(""),
    z.url({ protocol: /^https?$/, message: "Enter a full link starting with https://." }).max(1000, "This link is too long."),
  ]),
  notify: z.boolean(),
});

export async function markShippedAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const carrierChoice = formString(formData, "carrier");
  const parsed = shipSchema.safeParse({
    id: formString(formData, "id"),
    number: formData.get("number"),
    carrier: carrierChoice === "__other" ? formString(formData, "carrierOther") : carrierChoice,
    trackingNumber: formString(formData, "trackingNumber"),
    trackingUrl: formString(formData, "trackingUrl"),
    notify: formData.get("notify") === "on",
  });
  if (!parsed.success) return actionFail("Check the highlighted fields.", zodFieldErrors(parsed.error));
  const d = parsed.data;
  try {
    const ctx = await requireStaffContext();
    const res = await updateFulfillment(ctx, d.id, {
      status: "SHIPPED",
      carrier: d.carrier || null,
      trackingNumber: d.trackingNumber || null,
      trackingUrl: d.trackingUrl || null,
      notifyCustomer: d.notify,
    });
    revalidateBoard(d.id);
    return actionOk(t.ship.done(d.number, res.mailQueued));
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}
