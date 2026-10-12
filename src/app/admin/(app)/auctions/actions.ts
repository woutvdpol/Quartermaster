"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { requireTenantDisplay } from "@/server/tenant-display";
import { fail, failFrom } from "../_system/errors";
import { auctionsCopy as t } from "./_copy";
import { listBidsForReview, searchLotCandidates, type LotCandidate, type ReviewBid } from "./_data";
import { parseSchedule } from "./_lib";
import {
  addLots,
  blockBidder,
  cancelAuction,
  cancelWonLot,
  createAuction,
  publishAuction,
  removeLot,
  reorderLots,
  sendPaymentReminder,
  unblockBidder,
  updateAuction,
  updateLot,
  voidBid,
} from "./_service";

const PATH = "/admin/auctions";

function refresh(id?: string) {
  revalidatePath(PATH);
  if (id) {
    revalidatePath(`${PATH}/${id}`);
    revalidatePath(`${PATH}/${id}/results`);
  }
}

/** Create (no id) or update the schedule of an auction from the drawer form. */
export async function saveAuctionAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  let createdId: string | null = null;
  try {
    const ctx = await requireStaffContext();
    const { timeZone } = await requireTenantDisplay(ctx.tenantId);
    const parsed = parseSchedule(
      {
        type: formString(formData, "type"),
        title: formString(formData, "title"),
        opensAt: formString(formData, "opensAt"),
        firstCloseAt: formString(formData, "firstCloseAt"),
        gapSeconds: formString(formData, "gapMinutes"),
        extendSeconds: formString(formData, "extendMinutes"),
        payDays: formString(formData, "payDays"),
      },
      timeZone,
    );
    const productId = formString(formData, "productId");
    if (!id && parsed.ok && parsed.input.type === "SINGLE" && !productId) return fail(t.form.productRequired, { productId: [t.form.productRequired] });
    if (!parsed.ok) return fail("Check the highlighted fields.", parsed.errors);
    if (id) {
      const { type: _type, ...rest } = parsed.input;
      void _type; // the type can't change after creation
      await updateAuction(ctx, id, rest);
    } else {
      const created = (await createAuction(ctx, parsed.input)).id;
      if (parsed.input.type === "SINGLE") {
        try {
          await addLots(ctx, created, [productId]);
        } catch (err) {
          // Don't leave an empty single-lot draft behind when the item can't be added.
          await cancelAuction(ctx, created).catch(() => {});
          throw err;
        }
      }
      createdId = created;
    }
  } catch (err) {
    return failFrom(err);
  }
  refresh(id || undefined);
  if (createdId) redirect(`${PATH}/${createdId}`);
  return actionOk(t.form.saved);
}

export async function publishAuctionAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  try {
    await publishAuction(await requireStaffContext(), id);
  } catch (err) {
    return failFrom(err);
  }
  refresh(id);
  return actionOk(t.header.published);
}

export async function cancelAuctionAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  try {
    await cancelAuction(await requireStaffContext(), id);
  } catch (err) {
    return failFrom(err);
  }
  refresh(id);
  return actionOk(t.header.cancelled);
}

// ─── Lots ───────────────────────────────────────────────────────────────────

/** Lot picker search (client calls it directly). `auctionId` null = the single-lot create drawer. */
export async function searchLotCandidatesAction(auctionId: string | null, q: string): Promise<LotCandidate[]> {
  try {
    return await searchLotCandidates(await requireStaffContext(), auctionId, q);
  } catch {
    return [];
  }
}

export async function addLotsAction(auctionId: string, productIds: string[]): Promise<ActionResult> {
  if (!productIds.length) return fail("Choose at least one item.");
  try {
    await addLots(await requireStaffContext(), auctionId, productIds.slice(0, 500));
  } catch (err) {
    return failFrom(err);
  }
  refresh(auctionId);
  return actionOk(t.lots.added(productIds.length));
}

/** Inline start / reserve edit (minor units). `reservePrice` null = no reserve. */
export async function updateLotPriceAction(
  auctionId: string,
  lotId: string,
  field: "startPrice" | "reservePrice",
  value: number | null,
): Promise<ActionResult> {
  if (field !== "startPrice" && field !== "reservePrice") return fail("Unknown field.");
  if (value !== null && (!Number.isInteger(value) || value < 0)) return fail("Enter a valid amount.");
  if (field === "startPrice" && (value === null || value < 1)) return fail("A lot needs a start price.");
  try {
    await updateLot(await requireStaffContext(), lotId, { [field]: value });
  } catch (err) {
    return failFrom(err);
  }
  refresh(auctionId);
  return actionOk(t.lots.priceSaved);
}

export async function removeLotAction(formData: FormData): Promise<ActionResult> {
  const auctionId = formString(formData, "auctionId");
  try {
    await removeLot(await requireStaffContext(), formString(formData, "lotId"));
  } catch (err) {
    return failFrom(err);
  }
  refresh(auctionId);
  return actionOk(t.lots.removed);
}

export async function reorderLotsAction(auctionId: string, lotIds: string[]): Promise<ActionResult> {
  try {
    await reorderLots(await requireStaffContext(), auctionId, lotIds);
  } catch (err) {
    return failFrom(err);
  }
  refresh(auctionId);
  return actionOk(t.lots.reordered);
}

// ─── Signals / bidders ──────────────────────────────────────────────────────

export async function listBidsForReviewAction(auctionId: string, customerIds: string[], lotIds: string[]): Promise<ReviewBid[]> {
  try {
    return await listBidsForReview(await requireStaffContext(), auctionId, customerIds, lotIds);
  } catch {
    return [];
  }
}

export async function voidBidAction(formData: FormData): Promise<ActionResult> {
  const auctionId = formString(formData, "auctionId");
  const reason = formString(formData, "reason").trim();
  if (!reason) return fail(t.reasonRequired, { reason: [t.reasonRequired] });
  try {
    await voidBid(await requireStaffContext(), formString(formData, "bidId"), reason.slice(0, 500));
  } catch (err) {
    return failFrom(err);
  }
  refresh(auctionId);
  return actionOk(t.signals.voidedOk);
}

/** Blocks one or more customers (`customerIds` comma separated). */
export async function blockBiddersAction(formData: FormData): Promise<ActionResult> {
  const auctionId = formString(formData, "auctionId");
  const ids = formString(formData, "customerIds").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const reason = formString(formData, "reason").trim().slice(0, 500);
  if (!ids.length) return fail("Nobody to block.");
  try {
    const ctx = await requireStaffContext();
    for (const id of ids) await blockBidder(ctx, id, reason || null);
  } catch (err) {
    return failFrom(err);
  }
  refresh(auctionId || undefined);
  revalidatePath(`${PATH}/bidders`);
  for (const id of ids) revalidatePath(`/admin/customers/${id}`);
  return actionOk(ids.length === 1 ? t.customer.blockedOk : t.signals.blockedOk);
}

export async function unblockBidderAction(formData: FormData): Promise<ActionResult> {
  const customerId = formString(formData, "customerId");
  try {
    await unblockBidder(await requireStaffContext(), customerId);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(`${PATH}/bidders`);
  revalidatePath(`/admin/customers/${customerId}`);
  return actionOk(t.blocked.unblocked);
}

// ─── Results ────────────────────────────────────────────────────────────────

export async function sendReminderAction(formData: FormData): Promise<ActionResult> {
  const auctionId = formString(formData, "auctionId");
  try {
    await sendPaymentReminder(await requireStaffContext(), formString(formData, "lotId"));
  } catch (err) {
    return failFrom(err);
  }
  refresh(auctionId);
  return actionOk(t.results.reminded);
}

export async function cancelWonLotAction(formData: FormData): Promise<ActionResult> {
  const auctionId = formString(formData, "auctionId");
  const block = formData.get("block") === "on";
  try {
    await cancelWonLot(await requireStaffContext(), formString(formData, "lotId"), { blockBidder: block });
  } catch (err) {
    return failFrom(err);
  }
  refresh(auctionId);
  if (block) revalidatePath(`${PATH}/bidders`);
  return actionOk(t.results.cancelled);
}
