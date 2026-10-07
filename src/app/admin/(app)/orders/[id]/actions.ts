"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, formString, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  addOrderNote,
  archiveOrder,
  cancelOrder,
  markPaidManually,
  unarchiveOrder,
} from "@/server/orders/commands";
import { updateFulfillment } from "@/server/fulfillment";
import { formatInvoiceNumber, issueInvoice } from "@/server/invoices";
import { requireTenantDisplay } from "@/server/tenant-display";
import { opsCopy } from "./_ops-copy";
import { orderCopy as t } from "../_copy";
import { failFromError } from "../_lib/errors";

function revalidateOrder(id: string, customerId?: string | null) {
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin/shipping-board");
  if (customerId && /^[A-Za-z0-9_-]{1,64}$/.test(customerId)) revalidatePath(`/admin/customers/${customerId}`);
}

function orderId(formData: FormData) {
  return formString(formData, "id");
}

export async function markPaidAction(formData: FormData): Promise<ActionResult> {
  const id = orderId(formData);
  try {
    const ctx = await requireStaffContext();
    const result = await markPaidManually(ctx, id, formString(formData, "note") || null);
    revalidateOrder(id, formString(formData, "customerId"));
    return actionOk(result.oversold.length ? t.actions.markPaidOversold : t.actions.markPaidDone);
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}

export async function cancelOrderAction(formData: FormData): Promise<ActionResult> {
  const id = orderId(formData);
  try {
    const ctx = await requireStaffContext();
    await cancelOrder(ctx, id, formString(formData, "reason") || null);
    revalidateOrder(id, formString(formData, "customerId"));
    return actionOk(t.actions.cancelDone);
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}

export async function archiveOrderAction(formData: FormData): Promise<ActionResult> {
  const id = orderId(formData);
  try {
    const ctx = await requireStaffContext();
    await archiveOrder(ctx, id);
    revalidateOrder(id);
    return actionOk(t.actions.archiveDone);
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}

export async function unarchiveOrderAction(formData: FormData): Promise<ActionResult> {
  const id = orderId(formData);
  try {
    const ctx = await requireStaffContext();
    await unarchiveOrder(ctx, id);
    revalidateOrder(id);
    return actionOk(t.actions.unarchiveDone);
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}

export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = orderId(formData);
  const note = formString(formData, "note");
  if (!note) return actionFail(t.note.required, { note: [t.note.required] });
  if (note.length > 5000)
    return actionFail(t.note.required, {
      note: ["Keep the note under 5,000 characters."],
    });
  try {
    const ctx = await requireStaffContext();
    await addOrderNote(ctx, id, note);
    revalidatePath(`/admin/orders/${id}`);
    return actionOk(t.note.done);
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}

const fulfillmentSchema = z.object({
  status: z.enum(["UNFULFILLED", "PACKED", "SHIPPED", "DELIVERED"], {
    message: "Choose a status.",
  }),
  carrier: z.string().trim().max(100, "Keep the carrier under 100 characters."),
  trackingNumber: z.string().trim().max(200, "Keep the tracking code under 200 characters."),
  trackingUrl: z.union([
    z.literal(""),
    z
      .url({
        protocol: /^https?$/,
        message: "Enter a full link starting with https://.",
      })
      .max(1000, "This link is too long."),
  ]),
});

export async function setFulfillmentAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = orderId(formData);
  const parsed = fulfillmentSchema.safeParse({
    status: formData.get("status"),
    carrier: formString(formData, "carrier"),
    trackingNumber: formString(formData, "trackingNumber"),
    trackingUrl: formString(formData, "trackingUrl"),
  });
  if (!parsed.success) return actionFail("Check the highlighted fields.", zodFieldErrors(parsed.error));
  try {
    const ctx = await requireStaffContext();
    // Through the fulfillment service: same status/tracking update, plus the customer's "shipped"
    // mail (once per shipment) when the box is ticked. A preset carrier fills in the tracking link.
    const res = await updateFulfillment(ctx, id, {
      status: parsed.data.status,
      carrier: parsed.data.carrier || null,
      trackingNumber: parsed.data.trackingNumber || null,
      trackingUrl: parsed.data.trackingUrl || null,
      notifyCustomer: formData.get("notify") === "on",
    });
    revalidateOrder(id);
    return actionOk(res.mailQueued ? opsCopy.fulfillment.mailed : t.fulfillment.done);
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}

export async function issueInvoiceAction(formData: FormData): Promise<ActionResult> {
  const id = orderId(formData);
  try {
    const ctx = await requireStaffContext();
    const [res, display] = await Promise.all([issueInvoice(ctx, id), requireTenantDisplay(ctx.tenantId)]);
    revalidatePath(`/admin/orders/${id}`);
    const label = res.invoice ? formatInvoiceNumber(res.invoice.number, res.invoice.issuedAt, display.timeZone) : "";
    return actionOk(res.created ? opsCopy.invoice.issueDone(label) : opsCopy.invoice.already(label));
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}
