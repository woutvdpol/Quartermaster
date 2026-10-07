"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, formString, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { createCategory, deleteCategory, moveCategory, updateCategory } from "@/server/catalog/categories";
import { createTag, deleteTag, mergeTags, updateTag } from "@/server/catalog/tags";
import { errorResult } from "../inventory/_data";
import { copy } from "./_copy";

const r = copy.result;
const PATH = "/admin/categories";
const id = z.string().min(1).max(64);

function done() {
  revalidatePath(PATH);
  revalidatePath("/admin/inventory");
}

/** Error result that points CONFLICT/INVALID slug or title errors at the right field. */
function fieldAware(err: unknown, fallback: string): ActionResult {
  const res = errorResult(err, fallback);
  if (res.ok || !res.message) return res;
  if (/slug/i.test(res.message)) return actionFail(res.message, { slug: [res.message] });
  if (/tag with this name/i.test(res.message)) return actionFail(res.message, { name: [res.message] });
  if (/under itself|subcategor/i.test(res.message)) return actionFail(res.message, { parentId: [res.message] });
  return res;
}

// ─── Categories ─────────────────────────────────────────────────────────────

const categorySchema = z.object({
  id: id.optional(),
  title: z.string().trim().min(1, "Enter a title.").max(200, "Keep the title under 200 characters."),
  parentId: id.nullable(),
  slug: z.string().trim().max(120, "Keep the slug under 120 characters."),
  currentSlug: z.string().optional(),
  regenerateSlug: z.boolean(),
  isActive: z.boolean(),
  description: z.string().max(20000),
  seoTitle: z.string().max(200, "Keep the SEO title under 200 characters."),
  seoDescription: z.string().max(500, "Keep the SEO description under 500 characters."),
});

export async function saveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = categorySchema.safeParse({
    id: formString(formData, "id") || undefined,
    title: formString(formData, "title"),
    parentId: formString(formData, "parentId") || null,
    slug: formString(formData, "slug"),
    currentSlug: formString(formData, "currentSlug") || undefined,
    regenerateSlug: formData.get("regenerateSlug") === "on",
    isActive: formData.get("isActive") === "on",
    description: formString(formData, "description"),
    seoTitle: formString(formData, "seoTitle"),
    seoDescription: formString(formData, "seoDescription"),
  });
  if (!parsed.success) return actionFail(r.check, zodFieldErrors(parsed.error));
  const d = parsed.data;
  try {
    const ctx = await requireStaffContext();
    const fields = {
      title: d.title,
      isActive: d.isActive,
      description: d.description || null,
      seoTitle: d.seoTitle || null,
      seoDescription: d.seoDescription || null,
      parentId: d.parentId,
    };
    if (d.id) {
      await updateCategory(ctx, d.id, {
        ...fields,
        ...(d.regenerateSlug ? { regenerateSlug: true } : d.slug && d.slug !== d.currentSlug ? { slug: d.slug } : {}),
      });
      done();
      return actionOk(r.saved);
    }
    await createCategory(ctx, { ...fields, slug: d.slug || undefined });
    done();
    return actionOk(r.created(d.title));
  } catch (err) {
    return fieldAware(err, r.failed);
  }
}

const moveSchema = z.object({ id, parentId: id.nullable(), index: z.coerce.number().int().min(0).max(100_000) });

/** Up/down within the siblings: `index` is the target position among the other siblings. */
export async function moveCategoryAction(formData: FormData): Promise<ActionResult> {
  const parsed = moveSchema.safeParse({
    id: formString(formData, "id"),
    parentId: formString(formData, "parentId") || null,
    index: formString(formData, "index"),
  });
  if (!parsed.success) return actionFail(r.failed);
  try {
    const ctx = await requireStaffContext();
    await moveCategory(ctx, parsed.data.id, { parentId: parsed.data.parentId, index: parsed.data.index });
    revalidatePath(PATH);
    return actionOk(r.moved);
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

export async function deleteCategoryAction(formData: FormData): Promise<ActionResult> {
  const catId = id.safeParse(formString(formData, "id"));
  if (!catId.success) return actionFail(r.failed);
  const needsTarget = formString(formData, "needsTarget") === "1";
  const reassignTo = formString(formData, "reassignTo") || null;
  if (needsTarget && !reassignTo) return actionFail(r.chooseTarget);
  try {
    const ctx = await requireStaffContext();
    const moved = await deleteCategory(ctx, catId.data, { reassignTo });
    done();
    return actionOk(r.deleted(moved.movedProducts, moved.movedChildren));
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

// ─── Tags ───────────────────────────────────────────────────────────────────

const tagName = z.string().trim().min(1, "Enter a name.").max(100, "Keep the name under 100 characters.");

export async function createTagAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const name = tagName.safeParse(formString(formData, "name"));
  if (!name.success) return actionFail(name.error.issues[0]?.message, { name: name.error.issues.map((i) => i.message) });
  try {
    const ctx = await requireStaffContext();
    await createTag(ctx, { name: name.data });
    done();
    return actionOk(r.tagCreated(name.data));
  } catch (err) {
    return fieldAware(err, r.failed);
  }
}

const tagSchema = z.object({
  id,
  name: tagName,
  description: z.string().max(20000),
  regenerateSlug: z.boolean(),
});

export async function updateTagAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = tagSchema.safeParse({
    id: formString(formData, "id"),
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    regenerateSlug: formData.get("regenerateSlug") === "on",
  });
  if (!parsed.success) return actionFail(r.check, zodFieldErrors(parsed.error));
  try {
    const ctx = await requireStaffContext();
    await updateTag(ctx, parsed.data.id, {
      name: parsed.data.name,
      description: parsed.data.description || null,
      regenerateSlug: parsed.data.regenerateSlug,
    });
    done();
    return actionOk(r.tagSaved);
  } catch (err) {
    return fieldAware(err, r.failed);
  }
}

const idsSchema = z.array(id).min(1).max(100);

export async function deleteTagsAction(formData: FormData): Promise<ActionResult> {
  const ids = idsSchema.safeParse(formData.getAll("ids"));
  if (!ids.success) return actionFail(r.nothingSelected);
  try {
    const ctx = await requireStaffContext();
    for (const tagId of new Set(ids.data)) await deleteTag(ctx, tagId);
    done();
    return actionOk(r.tagsDeleted(new Set(ids.data).size));
  } catch (err) {
    // Tags deleted before the failure stay deleted; refresh the list either way.
    done();
    return errorResult(err, r.failed);
  }
}

export async function mergeTagsAction(formData: FormData): Promise<ActionResult> {
  const ids = idsSchema.safeParse(formData.getAll("ids"));
  if (!ids.success) return actionFail(r.nothingSelected);
  const target = id.safeParse(formString(formData, "targetId"));
  if (!target.success) return actionFail(r.chooseTag);
  try {
    const ctx = await requireStaffContext();
    const res = await mergeTags(ctx, ids.data, target.data);
    done();
    return actionOk(r.merged(res.deleted, res.linked));
  } catch (err) {
    return errorResult(err, r.failed);
  }
}
