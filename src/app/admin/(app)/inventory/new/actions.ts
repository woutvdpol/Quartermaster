"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionFail, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { createProduct } from "@/server/catalog/products";
import { copy, productEditPath } from "../[id]/_copy";
import { failFromError } from "../[id]/_lib/errors";

const e = copy.errors;

const createSchema = z.object({
  title: z.string().trim().min(1, e.titleRequired).max(300, e.tooLong(300)),
  price: z
    .string()
    .transform((v) => (v === "" ? 0 : Number(v)))
    .pipe(z.number({ message: e.priceInvalid }).int(e.priceInvalid).min(0, e.priceInvalid).max(1_000_000_000, e.priceInvalid)),
  quantity: z
    .string()
    .transform((v) => (v.trim() === "" ? 1 : Number(v.trim())))
    .pipe(z.number({ message: e.quantityInvalid }).int(e.quantityInvalid).min(0, e.quantityInvalid).max(1_000_000, e.quantityInvalid)),
  categoryId: z.string().max(64).transform((v) => v || null),
});

/** Minimal create: title, price, opening quantity, category → DRAFT; then opens the full editor. */
export async function createProductAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const s = (n: string) => {
    const v = formData.get(n);
    return typeof v === "string" ? v : "";
  };
  const parsed = createSchema.safeParse({ title: s("title"), price: s("price"), quantity: s("quantity"), categoryId: s("categoryId") });
  if (!parsed.success) return actionFail(e.checkFields, zodFieldErrors(parsed.error));

  let id: string;
  try {
    const ctx = await requireStaffContext();
    id = (await createProduct(ctx, { ...parsed.data, status: "DRAFT" })).id;
  } catch (err) {
    return failFromError(err);
  }
  revalidatePath("/admin/inventory");
  redirect(productEditPath(id));
}
