"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionFail, actionOk, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  bumpToTop,
  deleteProduct,
  duplicateProduct,
  getProduct,
  setStatus,
  updateProduct,
} from "@/server/catalog/products";
import { createTag, listTags } from "@/server/catalog/tags";
import { deleteProductImage, deleteProductMedia, reorderProductImages, updateImageAlt } from "@/server/media/product-images";
import { setPurchasePrices } from "@/server/purchasing";
import { adjustStock } from "@/server/stock/ledger";
import { adminReleaseReservation } from "@/server/stock/reservations";
import { ServiceError } from "@/server/context";
import type { ProductStatus } from "@/generated/prisma/enums";
import { copy, productEditPath } from "./_copy";
import { failFromError } from "./_lib/errors";

const INVENTORY = "/admin/inventory";
const idSchema = z.string().min(1).max(64);
const e = copy.errors;

function revalidateProduct(id: string) {
  revalidatePath(productEditPath(id));
  revalidatePath(INVENTORY);
}

function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

const optional = (max: number) =>
  z
    .string()
    .max(max, e.tooLong(max))
    .transform((v) => (v ? v : null));

/** Integer from a hidden MoneyInput / number field; "" → null. */
const intOrNull = (message: string) =>
  z
    .string()
    .transform((v, c) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isSafeInteger(n) || n < 0) {
        c.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return n;
    });

const saveSchema = z.object({
  id: idSchema,
  title: z.string().min(1, e.titleRequired).max(300, e.tooLong(300)),
  description: optional(100_000),
  sku: optional(100),
  price: intOrNull(e.priceInvalid).refine((v) => v !== null, e.priceInvalid),
  purchasePrice: intOrNull(e.priceInvalid),
  weightGrams: z
    .string()
    // "1.250" / "1,250" are thousands separators (whole grams); anything else must be an integer.
    .transform((v) => (v === "" ? 0 : Number(/^\d{1,3}([.,]\d{3})+$/.test(v) ? v.replace(/[.,]/g, "") : v)))
    .pipe(z.number({ message: e.weightInvalid }).int(e.weightInvalid).min(0, e.weightInvalid).max(10_000_000, e.weightInvalid)),
  notes: optional(20_000),
  seoTitle: optional(200),
  seoDescription: optional(500),
  slug: z.string().max(120, e.tooLong(120)),
  regenerateSlug: z.boolean(),
  categoryId: z.string().max(64).transform((v) => v || null),
  purchaseRecordId: z.string().max(64).transform((v) => v || null),
  ageRestricted: z.boolean(),
  blurred: z.boolean(),
  acceptsOffers: z.boolean(),
  restrictedSymbols: z.boolean(),
  requiresDeactivationCert: z.boolean(),
  onSale: z.boolean(),
  tags: z.array(z.string().trim().min(1).max(100, e.tooLong(100))).max(100),
  specifications: z
    .array(z.object({ label: z.string().max(200, e.tooLong(200)), value: z.string().max(2000, e.tooLong(2000)) }))
    .max(100)
    .superRefine((rows, c) => {
      rows.forEach((r, i) => {
        if (!r.label && r.value) c.addIssue({ code: "custom", message: e.specLabel, path: [i, "label"] });
      });
    })
    .transform((rows) => rows.filter((r) => r.label || r.value)),
});

/** Resolves tag names to ids, creating tags that do not exist yet (case-insensitive match). */
async function resolveTagIds(ctx: Awaited<ReturnType<typeof requireStaffContext>>, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const existing = await listTags(ctx);
  const byName = new Map(existing.map((t) => [t.name.toLocaleLowerCase(), t.id]));
  const ids: string[] = [];
  for (const name of names) {
    const key = name.toLocaleLowerCase();
    let id = byName.get(key);
    if (!id) {
      try {
        id = (await createTag(ctx, { name })).id;
      } catch (err) {
        // Created concurrently: the service reports the existing id.
        const dupe = err instanceof ServiceError && err.code === "CONFLICT" ? (err.details as { id?: string } | undefined)?.id : undefined;
        if (!dupe) throw err;
        id = dupe;
      }
      byName.set(key, id);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** One Save for all editable product fields (status, stock and photos have their own actions). */
export async function saveProductAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = saveSchema.safeParse({
    id: str(formData, "id"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    sku: str(formData, "sku"),
    price: str(formData, "price"),
    purchasePrice: str(formData, "purchasePrice"),
    weightGrams: str(formData, "weightGrams"),
    notes: str(formData, "notes"),
    seoTitle: str(formData, "seoTitle"),
    seoDescription: str(formData, "seoDescription"),
    slug: str(formData, "slug"),
    regenerateSlug: formData.get("regenerateSlug") === "on",
    categoryId: str(formData, "categoryId"),
    purchaseRecordId: str(formData, "purchaseRecordId"),
    ageRestricted: formData.get("ageRestricted") === "on",
    blurred: formData.get("blurred") === "on",
    acceptsOffers: formData.get("acceptsOffers") === "on",
    restrictedSymbols: formData.get("restrictedSymbols") === "on",
    requiresDeactivationCert: formData.get("requiresDeactivationCert") === "on",
    onSale: formData.get("onSale") === "on",
    tags: formData.getAll("tags").filter((v): v is string => typeof v === "string"),
    specifications: (() => {
      const labels = formData.getAll("specLabel");
      const values = formData.getAll("specValue");
      return labels.map((l, i) => ({ label: String(l).trim(), value: String(values[i] ?? "").trim() }));
    })(),
  });
  if (!parsed.success) return actionFail(e.checkFields, zodFieldErrors(parsed.error));
  const d = parsed.data;

  try {
    const ctx = await requireStaffContext();
    const current = await getProduct(ctx, d.id);
    const tagIds = await resolveTagIds(ctx, d.tags);
    const slugChanged = !d.regenerateSlug && d.slug !== "" && d.slug !== current.slug;
    await updateProduct(ctx, d.id, {
      title: d.title,
      description: d.description,
      specifications: d.specifications,
      sku: d.sku,
      price: d.price!,
      weightGrams: d.weightGrams,
      notes: d.notes,
      seoTitle: d.seoTitle,
      seoDescription: d.seoDescription,
      categoryId: d.categoryId,
      purchaseRecordId: d.purchaseRecordId,
      ageRestricted: d.ageRestricted,
      blurred: d.blurred,
      acceptsOffers: d.acceptsOffers,
      restrictedSymbols: d.restrictedSymbols,
      requiresDeactivationCert: d.requiresDeactivationCert,
      onSale: d.onSale,
      tagIds,
      ...(d.regenerateSlug ? { regenerateSlug: true } : slugChanged ? { slug: d.slug } : {}),
    });
    // Purchase price through purchasing: also back-fills cost snapshots of order lines sold without one.
    if (d.purchasePrice !== current.purchasePrice) {
      await setPurchasePrices(ctx, { prices: [{ productId: d.id, purchasePrice: d.purchasePrice }] });
    }
  } catch (err) {
    const result = failFromError(err);
    // Service field names → form field names.
    if (!result.ok && result.fieldErrors) {
      const fe = result.fieldErrors as Record<string, string[] | undefined>;
      if (fe.tagIds) fe.tags = fe.tagIds;
    }
    if (!result.ok && /price above 0/i.test(result.message ?? "")) {
      return actionFail(e.checkFields, { price: [result.message!] });
    }
    return result;
  }
  revalidateProduct(d.id);
  return actionOk(copy.savedToast, { savedAt: Date.now() });
}

// ─── Status / reservation ───────────────────────────────────────────────────

const statusSchema = z.enum(["DRAFT", "ACTIVE", "RESERVED", "SOLD", "ARCHIVED", "STOLEN"]);

export async function setStatusAction(productId: string, status: ProductStatus): Promise<ActionResult> {
  const id = idSchema.safeParse(productId);
  const s = statusSchema.safeParse(status);
  if (!id.success || !s.success) return actionFail(e.generic);
  try {
    const ctx = await requireStaffContext();
    await setStatus(ctx, [id.data], s.data);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "INVALID" && Array.isArray(err.details) && err.details[0]?.reason) {
      return actionFail(copy.status.blocked(String(err.details[0].reason).toLowerCase()));
    }
    return failFromError(err);
  }
  revalidateProduct(id.data);
  return actionOk();
}

export async function releaseReservationAction(productId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(productId);
  if (!id.success) return actionFail(e.generic);
  try {
    const ctx = await requireStaffContext();
    const released = await adminReleaseReservation(ctx, id.data);
    revalidateProduct(id.data);
    return actionOk(released ? copy.status.released : copy.status.releaseNone);
  } catch (err) {
    return failFromError(err);
  }
}

export async function bumpToTopAction(productId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(productId);
  if (!id.success) return actionFail(e.generic);
  try {
    const ctx = await requireStaffContext();
    await bumpToTop(ctx, [id.data]);
  } catch (err) {
    return failFromError(err);
  }
  revalidateProduct(id.data);
  return actionOk(copy.status.bumped);
}

// ─── Stock ──────────────────────────────────────────────────────────────────

const adjustSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("set"),
    quantity: z.coerce.number({ message: e.quantityInvalid }).int(e.quantityInvalid).min(0, e.quantityInvalid).max(1_000_000, e.quantityInvalid),
  }),
  z.object({
    mode: z.literal("delta"),
    delta: z.coerce
      .number({ message: e.quantityInvalid })
      .int(e.quantityInvalid)
      .min(-1_000_000, e.quantityInvalid)
      .max(1_000_000, e.quantityInvalid)
      .refine((v) => v !== 0, e.deltaZero),
  }),
]);

export async function adjustStockAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = idSchema.safeParse(str(formData, "id"));
  if (!id.success) return actionFail(e.generic);
  const mode = str(formData, "mode") === "delta" ? "delta" : "set";
  const raw = mode === "set" ? { mode, quantity: str(formData, "quantity") || undefined } : { mode, delta: str(formData, "delta") || undefined };
  const parsed = adjustSchema.safeParse(raw);
  if (!parsed.success) return actionFail(e.checkFields, zodFieldErrors(parsed.error));
  const note = str(formData, "note").slice(0, 500) || undefined;
  try {
    const ctx = await requireStaffContext();
    const input = parsed.data.mode === "set" ? { quantity: parsed.data.quantity, note } : { delta: parsed.data.delta, note };
    const result = await adjustStock(ctx, id.data, input);
    revalidateProduct(id.data);
    return actionOk(result.movement ? copy.stock.done(result.quantity) : copy.stock.noChange);
  } catch (err) {
    return failFromError(err, mode === "set" ? "quantity" : "delta");
  }
}

// ─── Duplicate / delete / archive ───────────────────────────────────────────

/** Copies the product into a new draft and opens it. Returns only on failure. */
export async function duplicateProductAction(productId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(productId);
  if (!id.success) return actionFail(e.generic);
  let newId: string;
  try {
    const ctx = await requireStaffContext();
    newId = (await duplicateProduct(ctx, id.data)).id;
  } catch (err) {
    return failFromError(err);
  }
  revalidatePath(INVENTORY);
  redirect(productEditPath(newId));
}

/** ConfirmDialog action. Deletes the product (service enforces DRAFT without history) and its files. */
export async function deleteProductAction(formData: FormData): Promise<ActionResult> {
  const id = idSchema.safeParse(str(formData, "id"));
  if (!id.success) return actionFail(e.generic);
  try {
    const ctx = await requireStaffContext();
    await deleteProduct(ctx, id.data);
    // deleteProduct removes the rows (images cascade) but leaves files on storage.
    await deleteProductMedia(ctx, id.data).catch((err) => console.error("[inventory/delete] media cleanup failed", err));
  } catch (err) {
    if (err instanceof ServiceError && err.code === "CONFLICT") return actionFail(copy.danger.cannotDelete);
    return failFromError(err);
  }
  revalidatePath(INVENTORY);
  redirect(INVENTORY);
}

export async function archiveProductAction(formData: FormData): Promise<ActionResult> {
  const id = str(formData, "id");
  const result = await setStatusAction(id, "ARCHIVED");
  return result.ok ? actionOk(copy.danger.archived) : result;
}

// ─── Photos (upload itself goes through ./images/route.ts) ─────────────────

export async function reorderImagesAction(productId: string, orderedIds: string[]): Promise<ActionResult> {
  const id = idSchema.safeParse(productId);
  const ids = z.array(idSchema).max(200).safeParse(orderedIds);
  if (!id.success || !ids.success) return actionFail(e.generic);
  try {
    const ctx = await requireStaffContext();
    await reorderProductImages(ctx, id.data, ids.data);
  } catch (err) {
    return failFromError(err);
  }
  revalidateProduct(id.data);
  return actionOk(copy.photos.reordered);
}

export async function updateImageAltAction(productId: string, imageId: string, alt: string): Promise<ActionResult> {
  const pid = idSchema.safeParse(productId);
  const iid = idSchema.safeParse(imageId);
  const text = z.string().trim().max(250, e.tooLong(250)).safeParse(alt);
  if (!pid.success || !iid.success) return actionFail(e.generic);
  if (!text.success) return actionFail(text.error.issues[0]?.message ?? e.generic);
  try {
    const ctx = await requireStaffContext();
    await updateImageAlt(ctx, iid.data, text.data || null);
  } catch (err) {
    return failFromError(err);
  }
  revalidatePath(productEditPath(pid.data));
  return actionOk(copy.photos.altSaved);
}

/** ConfirmDialog action: fields { productId, imageId }. */
export async function deleteImageAction(formData: FormData): Promise<ActionResult> {
  const pid = idSchema.safeParse(str(formData, "productId"));
  const iid = idSchema.safeParse(str(formData, "imageId"));
  if (!pid.success || !iid.success) return actionFail(e.generic);
  try {
    const ctx = await requireStaffContext();
    await deleteProductImage(ctx, iid.data);
  } catch (err) {
    return failFromError(err);
  }
  revalidateProduct(pid.data);
  return actionOk(copy.photos.deleted);
}
