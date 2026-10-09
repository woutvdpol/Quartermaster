"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  addFairItems,
  createFair,
  deleteFair,
  endFair,
  removeFairItem,
  searchFairCandidates,
  setFairItemFloor,
  startFair,
  updateFair,
  type FairCandidate,
} from "@/server/fairs";
import { failFrom, fail } from "../_system/errors";
import { fairsCopy as t } from "./_copy";

const PATH = "/admin/fairs";

function refresh(id?: string) {
  revalidatePath(PATH);
  if (id) revalidatePath(`${PATH}/${id}`);
}

/** Create (no id) or update a fair from the drawer form. */
export async function saveFairAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  let createdId: string | null = null;
  try {
    const ctx = await requireStaffContext();
    const input = {
      name: formString(formData, "name"),
      startsOn: formString(formData, "startsOn"),
      endsOn: formString(formData, "endsOn") || null,
      hideFromShop: formData.get("hideFromShop") === "on",
      notes: formString(formData, "notes") || null,
    };
    if (id) await updateFair(ctx, id, input);
    else createdId = (await createFair(ctx, input)).id;
  } catch (err) {
    return failFrom(err);
  }
  refresh(id || undefined);
  if (createdId) redirect(`${PATH}/${createdId}`);
  return actionOk(t.form.saved);
}

export async function deleteFairAction(formData: FormData): Promise<ActionResult> {
  try {
    await deleteFair(await requireStaffContext(), formString(formData, "id"));
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  redirect(PATH);
}

export async function startFairAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  try {
    await startFair(await requireStaffContext(), id);
  } catch (err) {
    return failFrom(err);
  }
  refresh(id);
  return actionOk(t.live.started);
}

export async function endFairAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  try {
    await endFair(await requireStaffContext(), id);
  } catch (err) {
    return failFrom(err);
  }
  refresh(id);
  return actionOk(t.live.ended);
}

/** Item picker search (client calls it directly). */
export async function searchFairCandidatesAction(fairId: string, q: string): Promise<FairCandidate[]> {
  try {
    return await searchFairCandidates(await requireStaffContext(), fairId, q);
  } catch {
    return [];
  }
}

export async function addFairItemsAction(fairId: string, productIds: string[]): Promise<ActionResult> {
  let message: string;
  try {
    const r = await addFairItems(await requireStaffContext(), fairId, productIds);
    message = t.items.added(r.added, r.skipped);
  } catch (err) {
    return failFrom(err);
  }
  refresh(fairId);
  return actionOk(message);
}

export async function removeFairItemAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "fairId");
  try {
    await removeFairItem(await requireStaffContext(), id, formString(formData, "productId"));
  } catch (err) {
    return failFrom(err);
  }
  refresh(id);
  return actionOk(t.items.removed);
}

/** Inline floor edit: `floor` in minor units, "" = no floor (list price is the minimum). */
export async function setFloorAction(fairId: string, productId: string, floor: number | null): Promise<ActionResult> {
  if (floor !== null && (!Number.isInteger(floor) || floor < 0)) return fail("Enter a valid amount.");
  try {
    await setFairItemFloor(await requireStaffContext(), fairId, productId, floor);
  } catch (err) {
    return failFrom(err);
  }
  refresh(fairId);
  return actionOk(t.items.floorSaved);
}
