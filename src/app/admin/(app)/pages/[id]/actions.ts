"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionFail, actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import { blockTypeSchema, catalogEntry } from "@/server/content/blocks";
import { addBlock, deletePage, getPage, moveBlock, removeBlock, updateBlock, updatePage } from "@/server/content/pages";
import { SYSTEM_PAGE_KEYS, type SystemPageKey } from "@/server/content/rules";
import { ImageProcessingError, processImage } from "@/server/media/images";
import { assertValidKey, getStorage } from "@/server/media/storage";
import { copy } from "../_copy";
import { failFrom } from "../_lib/errors";
import { searchPickerProducts, searchProductImages, type PickerImage, type PickerProduct } from "./_data";

/*
 * Page editor actions. Every action re-checks the staff context; services enforce tenant ownership
 * of the page/block ids passed from the client.
 */

const LIST = "/admin/pages";
const pagePath = (id: string) => `${LIST}/${id}`;

function revalidatePage(pageId: string) {
  revalidatePath(pagePath(pageId));
  revalidatePath(LIST);
}

/** Failed results carry no data, so they fit any typed result. */
const failed = <D,>(r: ActionResult) => r as unknown as ActionResult<string, D>;

const asId = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null);

// ─── Page settings ───────────────────────────────────────────────────────────

export async function updatePageSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  const title = formString(formData, "title");
  if (!title) return actionFail("Enter a title.", { title: ["Enter a title."] });
  const role = formString(formData, "systemKey");
  const systemKey = (SYSTEM_PAGE_KEYS as readonly string[]).includes(role) ? (role as SystemPageKey) : undefined;
  try {
    const ctx = await requireStaffContext();
    await updatePage(ctx, id, {
      title,
      slug: formString(formData, "slug"),
      seoTitle: formString(formData, "seoTitle"),
      seoDescription: formString(formData, "seoDescription"),
      published: formData.get("published") === "on",
      ...(systemKey ? { systemKey } : {}),
    });
  } catch (err) {
    if (err instanceof ServiceError && (err.code === "CONFLICT" || (err.code === "INVALID" && /slug|reserved/i.test(err.message)))) {
      const field = /role/i.test(err.message) ? "systemKey" : "slug";
      return actionFail(err.message, { [field]: [err.message] });
    }
    return failFrom(err);
  }
  revalidatePage(id);
  revalidatePath("/admin/menus");
  return actionOk(copy.editor.saved);
}

export async function deletePageFromEditorAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  try {
    const ctx = await requireStaffContext();
    await deletePage(ctx, id);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(LIST);
  revalidatePath("/admin/menus");
  redirect(LIST);
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

export async function addBlockAction(pageId: string, type: string, afterId?: string | null): Promise<ActionResult<string, { id: string }>> {
  const parsedType = blockTypeSchema.safeParse(type);
  if (!asId(pageId) || !parsedType.success) return failed(actionFail("Unknown block type."));
  try {
    const ctx = await requireStaffContext();
    const block = await addBlock(ctx, pageId, { type: parsedType.data, ...(afterId !== undefined ? { afterId } : {}) });
    revalidatePage(pageId);
    return actionOk(copy.picker.added(catalogEntry(parsedType.data).label), { id: block.id });
  } catch (err) {
    return failed(failFrom(err));
  }
}

/** Saves a block's data. Validation issues come back as field errors keyed by data path (`cta.href`). */
export async function saveBlockAction(pageId: string, blockId: string, data: unknown): Promise<ActionResult> {
  if (!asId(pageId) || !asId(blockId)) return actionFail();
  try {
    const ctx = await requireStaffContext();
    await updateBlock(ctx, blockId, { data });
    revalidatePage(pageId);
    return actionOk(copy.block.saved);
  } catch (err) {
    return failFrom(err);
  }
}

export async function setBlockVisibleAction(pageId: string, blockId: string, visible: boolean): Promise<ActionResult> {
  if (!asId(pageId) || !asId(blockId)) return actionFail();
  try {
    const ctx = await requireStaffContext();
    await updateBlock(ctx, blockId, { isVisible: visible === true });
    revalidatePage(pageId);
    return actionOk(visible ? "Block is visible in the shop." : "Block is hidden from the shop.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function moveBlockAction(pageId: string, blockId: string, newIndex: number): Promise<ActionResult> {
  if (!asId(pageId) || !asId(blockId) || !Number.isInteger(newIndex) || newIndex < 0) return actionFail();
  try {
    const ctx = await requireStaffContext();
    await moveBlock(ctx, blockId, newIndex);
    revalidatePage(pageId);
    return actionOk();
  } catch (err) {
    return failFrom(err);
  }
}

export async function removeBlockAction(formData: FormData): Promise<ActionResult> {
  const pageId = formString(formData, "pageId");
  const blockId = formString(formData, "blockId");
  try {
    const ctx = await requireStaffContext();
    await removeBlock(ctx, blockId);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePage(pageId);
  return actionOk(copy.block.removed);
}

// ─── Pickers (read-only) ─────────────────────────────────────────────────────

export async function searchProductsAction(query: string): Promise<ActionResult<string, PickerProduct[]>> {
  try {
    const ctx = await requireStaffContext();
    return actionOk(undefined, await searchPickerProducts(ctx, typeof query === "string" ? query : ""));
  } catch (err) {
    return failed(failFrom(err));
  }
}

export async function searchImagesAction(query: string): Promise<ActionResult<string, PickerImage[]>> {
  try {
    const ctx = await requireStaffContext();
    return actionOk(undefined, await searchProductImages(ctx, typeof query === "string" ? query : ""));
  } catch (err) {
    return failed(failFrom(err));
  }
}

// ─── Image upload for content blocks ─────────────────────────────────────────

/** Upload cap; Server Action bodies are limited by serverActions.bodySizeLimit. */
// Matches serverActions.bodySizeLimit (26mb) in next.config.ts minus form overhead.
const MAX_CONTENT_UPLOAD = 25 * 1024 * 1024;

/**
 * Stores an image for this page under `{tenantId}/content/{pageId}/{imageId}.{ext}` with WebP
 * variants at `{…}/{imageId}/{variant}.webp` (same layout as product images). Returns the key; the
 * block references it once saved. Not counted in tenant storage usage yet (no content-media table).
 */
export async function uploadBlockImageAction(_prev: ActionState, formData: FormData): Promise<ActionResult<string, { key: string }>> {
  const pageId = formString(formData, "pageId");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return failed(actionFail("Choose an image file.", { file: ["Choose an image file."] }));
  if (file.size > MAX_CONTENT_UPLOAD) return failed(actionFail(copy.image.tooLarge, { file: [copy.image.tooLarge] }));
  try {
    const ctx = await requireStaffContext();
    await getPage(ctx, pageId); // NOT_FOUND unless the page is this tenant's
    const img = await processImage(new Uint8Array(await file.arrayBuffer()));
    const base = `${ctx.tenantId}/content/${pageId}/c${randomBytes(12).toString("hex")}`;
    const key = `${base}.${img.ext}`;
    assertValidKey(key);
    const storage = getStorage();
    await storage.put(key, img.original.data, img.mimeType);
    for (const [name, variant] of Object.entries(img.variants)) {
      await storage.put(`${base}/${name}.webp`, variant.data, "image/webp");
    }
    return actionOk("Image uploaded.", { key });
  } catch (err) {
    if (err instanceof ImageProcessingError) return failed(actionFail(err.message, { file: [err.message] }));
    return failed(failFrom(err));
  }
}
