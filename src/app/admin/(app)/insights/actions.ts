"use server";

import { revalidatePath } from "next/cache";
import { actionFail, actionOk, formatMoney, type ActionResult } from "@/components/admin/ui";
import { AuthError } from "@/server/auth/guards";
import { ServiceError, requireStaffContext } from "@/server/context";
import { repriceStaleItem } from "@/server/insights";
import { requireTenantDisplay } from "@/server/tenant-display";
import { PATH, copy } from "./_copy";

/** "Reprice to €X" (after the confirm dialog): lowers the price through the product service. */
export async function repriceAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    const res = await repriceStaleItem(ctx, {
      productId: String(formData.get("productId") ?? ""),
      expectedPrice: String(formData.get("expectedPrice") ?? ""),
      price: String(formData.get("price") ?? ""),
    });
    const { currency } = await requireTenantDisplay(ctx.tenantId);
    revalidatePath(PATH);
    revalidatePath("/admin/inventory");
    return actionOk(copy.stale.repriced(res.stockCode, formatMoney(res.price, currency)));
  } catch (err) {
    if (err instanceof AuthError) return actionFail(err.code === "UNAUTHENTICATED" ? copy.errors.unauthenticated : copy.errors.forbidden);
    if (err instanceof ServiceError && err.code !== "FORBIDDEN") return actionFail(err.message);
    console.error("[insights] reprice failed", err);
    return actionFail(copy.errors.generic);
  }
}
