"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, formString, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { bulkUpdate, bumpToTop, setStatus } from "@/server/catalog/products";
import { copy } from "./_copy";
import { errorResult } from "./_data";

/*
 * Bulk actions for the inventory list. Each receives the selected ids as repeated `ids` fields
 * (BulkActions renders them inside every dialog form) and returns an ActionResult for ConfirmDialog.
 */

const t = copy.result;
const PATH = "/admin/inventory";

const idsSchema = z.array(z.string().min(1).max(64)).min(1).max(500);
const statusSchema = z.enum(["DRAFT", "ACTIVE", "RESERVED", "SOLD", "ARCHIVED", "STOLEN"]);

function readIds(formData: FormData): string[] | null {
  const parsed = idsSchema.safeParse(formData.getAll("ids").filter((v) => typeof v === "string"));
  return parsed.success ? [...new Set(parsed.data)] : null;
}

function done() {
  revalidatePath(PATH);
  revalidatePath("/admin/dashboard");
}

export async function bulkStatusAction(formData: FormData): Promise<ActionResult> {
  const ids = readIds(formData);
  if (!ids) return actionFail(t.noSelection);
  const status = statusSchema.safeParse(formString(formData, "status"));
  if (!status.success) return actionFail(t.badStatus);
  try {
    const ctx = await requireStaffContext();
    const { updated } = await setStatus(ctx, ids, status.data);
    done();
    return actionOk(t.status(updated));
  } catch (err) {
    return errorResult(err, t.failed);
  }
}

export async function bulkCategoryAction(formData: FormData): Promise<ActionResult> {
  const ids = readIds(formData);
  if (!ids) return actionFail(t.noSelection);
  const raw = formString(formData, "categoryId");
  const categoryId = raw === "" || raw === "none" ? null : raw;
  try {
    const ctx = await requireStaffContext();
    const { updated } = await bulkUpdate(ctx, ids, { categoryId });
    done();
    revalidatePath("/admin/categories");
    return actionOk(t.category(updated));
  } catch (err) {
    return errorResult(err, t.failed);
  }
}

export async function bulkPriceAction(formData: FormData): Promise<ActionResult> {
  const ids = readIds(formData);
  if (!ids) return actionFail(t.noSelection);
  const percent = Number(formString(formData, "percent").replace(",", "."));
  if (!Number.isFinite(percent) || percent <= -100 || percent > 1000 || percent === 0) return actionFail(t.badPercent);
  try {
    const ctx = await requireStaffContext();
    const { updated } = await bulkUpdate(ctx, ids, { priceAdjustPercent: Math.round(percent * 100) / 100 });
    done();
    return actionOk(t.price(updated));
  } catch (err) {
    return errorResult(err, t.failed);
  }
}

export async function bulkBumpAction(formData: FormData): Promise<ActionResult> {
  const ids = readIds(formData);
  if (!ids) return actionFail(t.noSelection);
  try {
    const ctx = await requireStaffContext();
    const { updated } = await bumpToTop(ctx, ids);
    done();
    return actionOk(t.bump(updated));
  } catch (err) {
    return errorResult(err, t.failed);
  }
}

export async function bulkArchiveAction(formData: FormData): Promise<ActionResult> {
  const ids = readIds(formData);
  if (!ids) return actionFail(t.noSelection);
  try {
    const ctx = await requireStaffContext();
    const { updated } = await setStatus(ctx, ids, "ARCHIVED");
    done();
    return actionOk(t.archive(updated));
  } catch (err) {
    return errorResult(err, t.failed);
  }
}
