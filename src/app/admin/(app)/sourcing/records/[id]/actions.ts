"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionFail, actionOk, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listProducts } from "@/server/catalog/products";
import {
  allocatePurchaseRecordCost,
  deletePurchaseRecord,
  linkProductsToPurchaseRecord,
  setPurchasePrices,
  unlinkProductsFromPurchaseRecord,
} from "@/server/purchasing";
import { copy } from "../../_copy";
import { failFrom } from "../../_lib/errors";

const id = z.string().trim().min(1).max(64);

function revalidate(recordId: string) {
  revalidatePath(`/admin/sourcing/records/${recordId}`);
  revalidatePath("/admin/sourcing");
  revalidatePath("/admin/sourcing/margin");
}

export async function deleteRecordAction(formData: FormData): Promise<ActionResult> {
  const recordId = id.safeParse(formData.get("id"));
  if (!recordId.success) return actionFail("Missing record.");
  try {
    const ctx = await requireStaffContext();
    await deletePurchaseRecord(ctx, recordId.data);
  } catch (e) {
    return failFrom(e);
  }
  revalidatePath("/admin/sourcing", "layout");
  redirect("/admin/sourcing");
}

export async function allocateCostAction(formData: FormData): Promise<ActionResult> {
  const recordId = id.safeParse(formData.get("id"));
  const method = z.enum(["equal", "byPrice"]).safeParse(formData.get("method"));
  if (!recordId.success || !method.success) return actionFail("Choose a split method.");
  try {
    const ctx = await requireStaffContext();
    const res = await allocatePurchaseRecordCost(ctx, recordId.data, method.data);
    revalidate(recordId.data);
    return actionOk(copy.detail.allocated(res.updated));
  } catch (e) {
    return failFrom(e);
  }
}

export async function savePurchasePricesAction(
  recordId: string,
  prices: { productId: string; purchasePrice: number | null }[],
): Promise<ActionResult> {
  const parsed = z
    .object({
      recordId: id,
      prices: z.array(z.object({ productId: id, purchasePrice: z.int().min(0).max(1_000_000_000).nullable() })).min(1).max(1000),
    })
    .safeParse({ recordId, prices });
  if (!parsed.success) return actionFail("Some prices are not valid. Use amounts of zero or more.");
  try {
    const ctx = await requireStaffContext();
    const res = await setPurchasePrices(ctx, { prices: parsed.data.prices });
    revalidate(parsed.data.recordId);
    return actionOk(copy.detail.pricesSaved(res.updated, res.orderLinesBackfilled));
  } catch (e) {
    return failFrom(e, { NOT_FOUND: "One of the products no longer exists. Reload the page." });
  }
}

export async function unlinkProductAction(recordId: string, productId: string): Promise<ActionResult> {
  const parsed = z.object({ recordId: id, productId: id }).safeParse({ recordId, productId });
  if (!parsed.success) return actionFail("Missing product.");
  try {
    const ctx = await requireStaffContext();
    await unlinkProductsFromPurchaseRecord(ctx, parsed.data.recordId, [parsed.data.productId]);
    revalidate(parsed.data.recordId);
    return actionOk(copy.detail.unlinked);
  } catch (e) {
    return failFrom(e);
  }
}

export async function linkProductsAction(recordId: string, productIds: string[]): Promise<ActionResult> {
  const parsed = z.object({ recordId: id, productIds: z.array(id).min(1).max(200) }).safeParse({ recordId, productIds });
  if (!parsed.success) return actionFail("Pick at least one product.");
  try {
    const ctx = await requireStaffContext();
    const res = await linkProductsToPurchaseRecord(ctx, parsed.data.recordId, parsed.data.productIds);
    revalidate(parsed.data.recordId);
    return actionOk(copy.picker.linked(res.linked));
  } catch (e) {
    return failFrom(e, { NOT_FOUND: "This record or one of the products no longer exists. Reload the page." });
  }
}

export type PickerProduct = {
  id: string;
  stockCode: number;
  title: string;
  status: string;
  price: number;
  purchasePrice: number | null;
};

/** Read-only product search for the link picker (wraps listProducts). */
export async function searchProductsAction(query: string): Promise<ActionResult<string, PickerProduct[]>> {
  const q = z.string().trim().min(2).max(200).safeParse(query);
  if (!q.success) return actionOk(undefined, []);
  try {
    const ctx = await requireStaffContext();
    const res = await listProducts(ctx, { view: "all", search: q.data, pageSize: 20, page: 1 });
    return actionOk(
      undefined,
      res.rows.map((p) => ({
        id: p.id,
        stockCode: p.stockCode,
        title: p.title,
        status: p.status,
        price: p.price,
        purchasePrice: p.purchasePrice,
      })),
    );
  } catch (e) {
    return failFrom(e) as ActionResult<string, PickerProduct[]>;
  }
}
