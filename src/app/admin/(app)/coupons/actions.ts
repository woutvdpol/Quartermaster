"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { requireTenantDisplay } from "@/server/tenant-display";
import { createCoupon, deleteCoupon, setCouponActive, updateCoupon, type CouponInput } from "@/server/coupons";
import { failFrom, fail } from "../_system/errors";
import { couponsCopy as t } from "./_copy";
import { localInputToDate } from "./_lib";

const PATH = "/admin/coupons";

/** Create (no id) or update a coupon from the drawer form. */
export async function saveCouponAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  const type = formString(formData, "type");
  let value = 0;
  if (type === "PERCENT") {
    const pct = Number(formString(formData, "percent").replace(",", "."));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return fail("Check the highlighted fields.", { percent: ["Enter a percentage between 0.01 and 100."] });
    value = Math.round(pct * 100);
  } else if (type === "FIXED") {
    value = Number(formString(formData, "amount") || 0);
  }
  try {
    const ctx = await requireStaffContext();
    const { timeZone } = await requireTenantDisplay(ctx.tenantId);
    const input: CouponInput = {
      code: formString(formData, "code"),
      description: formString(formData, "description") || null,
      type: type as CouponInput["type"],
      value,
      minSubtotal: Number(formString(formData, "minSubtotal") || 0),
      startsAt: localInputToDate(formString(formData, "startsAt"), timeZone),
      endsAt: localInputToDate(formString(formData, "endsAt"), timeZone),
      maxRedemptions: formString(formData, "maxRedemptions") || null,
      perEmailLimit: formString(formData, "perEmailLimit") || null,
      isActive: formData.get("isActive") === "on",
    };
    if (id) await updateCoupon(ctx, id, input);
    else await createCoupon(ctx, input);
  } catch (err) {
    const res = failFrom(err);
    // value errors belong to the visible field of the chosen type
    if (res.fieldErrors?.value) res.fieldErrors[type === "PERCENT" ? "percent" : "amount"] = res.fieldErrors.value;
    return res;
  }
  revalidatePath(PATH);
  if (id) revalidatePath(`${PATH}/${id}`);
  return actionOk(id ? t.form.saved : t.form.created);
}

export async function setCouponActiveAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  const active = formString(formData, "active") === "1";
  try {
    const ctx = await requireStaffContext();
    await setCouponActive(ctx, id, active);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${id}`);
  return actionOk(active ? t.activated : t.deactivated);
}

export async function deleteCouponAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await deleteCoupon(ctx, formString(formData, "id"));
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  redirect(PATH);
}
