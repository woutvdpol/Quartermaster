"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionFail, actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import { createPage, deletePage, duplicatePage, ensureSystemPages } from "@/server/content/pages";
import { copy } from "./_copy";
import { failFrom } from "./_lib/errors";

const LIST = "/admin/pages";

/** Creates an empty draft page and opens it in the editor. */
export async function createPageAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const title = formString(formData, "title");
  const slug = formString(formData, "slug");
  if (!title) return actionFail("Enter a title.", { title: ["Enter a title."] });
  let id: string;
  try {
    const ctx = await requireStaffContext();
    const page = await createPage(ctx, { title, slug: slug || undefined });
    id = page.id;
  } catch (err) {
    // Slug problems (reserved, empty, taken) come without a field path; put them on the slug field.
    if (err instanceof ServiceError && (err.code === "CONFLICT" || (err.code === "INVALID" && /slug|reserved/i.test(err.message)))) {
      return actionFail(err.message, { slug: [err.message] });
    }
    return failFrom(err);
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${id}`);
}

export async function duplicatePageAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  if (!id) return actionFail(copy.list.duplicate);
  try {
    const ctx = await requireStaffContext();
    await duplicatePage(ctx, id);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(LIST);
  return actionOk(copy.list.duplicated);
}

export async function deletePageAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  if (!id) return actionFail();
  try {
    const ctx = await requireStaffContext();
    await deletePage(ctx, id);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(LIST);
  revalidatePath("/admin/menus");
  return actionOk(copy.list.deleted);
}

/** Creates HOME/TERMS/PRIVACY/CONTACT/ABOUT when missing (idempotent, drafts with starter content). */
export async function ensureSystemPagesAction(): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    const created = await ensureSystemPages(ctx.tenantId);
    revalidatePath(LIST);
    return actionOk(copy.list.ensureSystemDone(created));
  } catch (err) {
    return failFrom(err);
  }
}
