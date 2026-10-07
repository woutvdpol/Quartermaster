"use server";

import { revalidatePath } from "next/cache";
import { actionFail, actionOk, formString, type ActionResult, type ActionState, type FieldErrors } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { createMenuItem, deleteMenuItem, reorderMenuItems, updateMenuItem, type MenuTarget } from "@/server/content/menus";
import { SYSTEM_ROUTE_KEYS, type SystemRouteKey } from "@/server/content/rules";
import { MenuLocation } from "@/generated/prisma/enums";
import { failFrom } from "../pages/_lib/errors";
import { copy } from "./_copy";

const PATH = "/admin/menus";

const asLocation = (v: string): MenuLocation | null => (v === "HEADER" || v === "FOOTER" ? v : null);

/** Builds the service target from the form; `undefined` = invalid choice (field error). */
function readTarget(formData: FormData): { target: MenuTarget | null } | { error: FieldErrors } {
  const kind = formString(formData, "kind");
  switch (kind) {
    case "none":
      return { target: null };
    case "page": {
      const pageId = formString(formData, "pageId");
      return pageId ? { target: { kind: "page", pageId } } : { error: { pageId: [copy.form.choosePage.replace("…", ".")] } };
    }
    case "category": {
      const categoryId = formString(formData, "categoryId");
      return categoryId ? { target: { kind: "category", categoryId } } : { error: { categoryId: [copy.form.chooseCategory.replace("…", ".")] } };
    }
    case "route": {
      const route = formString(formData, "route");
      return (SYSTEM_ROUTE_KEYS as string[]).includes(route)
        ? { target: { kind: "route", route: route as SystemRouteKey } }
        : { error: { route: [copy.form.chooseRoute.replace("…", ".")] } };
    }
    case "url": {
      const url = formString(formData, "url");
      return url ? { target: { kind: "url", url } } : { error: { url: ["Enter a web address."] } };
    }
    default:
      return { error: { kind: [copy.form.needsLink] } };
  }
}

/** Service issue paths (`target.url`, `label`) → form field names. */
function remap(result: ActionResult): ActionResult {
  if (result.ok || !result.fieldErrors) return result;
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(result.fieldErrors)) {
    const key = k.startsWith("target.") ? k.slice("target.".length) : k === "target" ? "kind" : k;
    out[key] = [...(out[key] ?? []), ...(v ?? [])];
  }
  return { ...result, fieldErrors: out };
}

/** Creates (no `id`) or updates a menu item. */
export async function saveMenuItemAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  const location = asLocation(formString(formData, "location"));
  const parentId = formString(formData, "parentId") || null;
  const label = formString(formData, "label");
  const fieldErrors: FieldErrors = {};
  if (!label) fieldErrors.label = ["Enter a label."];
  const read = readTarget(formData);
  if ("error" in read) Object.assign(fieldErrors, read.error);
  if (!location) return actionFail("Unknown menu.");
  if (Object.keys(fieldErrors).length || "error" in read) return actionFail("Check the highlighted fields.", fieldErrors);
  try {
    const ctx = await requireStaffContext();
    if (id) await updateMenuItem(ctx, id, { label, target: read.target });
    else await createMenuItem(ctx, { location, parentId, label, target: read.target });
  } catch (err) {
    return remap(failFrom(err, { fieldPrefix: undefined }));
  }
  revalidatePath(PATH);
  return actionOk(id ? copy.saved : copy.added);
}

export async function deleteMenuItemAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  try {
    const ctx = await requireStaffContext();
    await deleteMenuItem(ctx, id);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk(copy.deleted);
}

/** Sets the order of one menu level (root items, or one item's sub-items). */
export async function reorderMenuAction(location: string, parentId: string | null, orderedIds: string[]): Promise<ActionResult> {
  const loc = asLocation(location);
  if (!loc || !Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === "string")) return actionFail();
  try {
    const ctx = await requireStaffContext();
    await reorderMenuItems(ctx, loc, typeof parentId === "string" && parentId ? parentId : null, orderedIds);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk();
}
