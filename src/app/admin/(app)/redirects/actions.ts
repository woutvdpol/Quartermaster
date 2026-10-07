"use server";

import { revalidatePath } from "next/cache";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { createRedirect, deleteRedirect, importRedirectsCsv, updateRedirect, type ImportResult } from "@/server/redirects";
import { fail, failFrom } from "../_system/errors";
import { redirectsCopy as t } from "./_copy";

const PATH = "/admin/redirects";
const MAX_CSV_BYTES = 1_000_000;

/** Create (no id) or update a manual redirect from the drawer form. */
export async function saveRedirectAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  try {
    const ctx = await requireStaffContext();
    const input = {
      fromPath: formString(formData, "fromPath"),
      toPath: formString(formData, "toPath"),
      statusCode: formString(formData, "statusCode") === "302" ? 302 : 301,
    };
    if (id) await updateRedirect(ctx, id, input);
    else await createRedirect(ctx, input);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk(id ? t.form.saved : t.form.created);
}

export async function deleteRedirectAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await deleteRedirect(ctx, formString(formData, "id"));
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk(t.deleted);
}

/** CSV import from an uploaded file or pasted text. Returns per-line errors as data. */
export async function importRedirectsAction(_prev: ActionState<string, ImportResult>, formData: FormData): Promise<ActionResult<string, ImportResult>> {
  const file = formData.get("file");
  let csv = formString(formData, "csv");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) return fail("The file is too large (max 1 MB).", { file: ["The file is too large (max 1 MB)."] });
    csv = await file.text();
  }
  if (!csv.trim()) return fail(t.import.nothing);
  let result: ImportResult;
  try {
    const ctx = await requireStaffContext();
    result = await importRedirectsCsv(ctx, csv);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return { ok: true, message: t.import.done(result.created, result.updated), data: result };
}
