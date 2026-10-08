"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/server/context";
import {
  LOGO_MAX_BYTES,
  discardThemeDraft,
  publishThemeDraft,
  saveThemeDraft,
  storeThemeLogo,
  type ThemeState,
} from "@/server/theme";
import { failFrom, fail, type Failure } from "../_system/errors";

/*
 * Server actions of the theme builder (ThemeBuilder). They return the fresh ThemeState so the
 * builder can update its "unpublished changes" indicator and contrast warnings without a refetch.
 */

export type ThemeActionResult = { ok: true; state: ThemeState; message?: string } | Failure;

export async function saveThemeDraftAction(theme: unknown): Promise<ThemeActionResult> {
  try {
    const ctx = await requireStaffContext();
    return { ok: true, state: await saveThemeDraft(ctx, theme) };
  } catch (err) {
    return failFrom(err);
  }
}

export async function publishThemeAction(): Promise<ThemeActionResult> {
  try {
    const ctx = await requireStaffContext();
    const state = await publishThemeDraft(ctx);
    revalidatePath("/admin/theme");
    return { ok: true, state, message: "Theme published. The shop now shows it." };
  } catch (err) {
    return failFrom(err);
  }
}

export async function discardThemeDraftAction(): Promise<ThemeActionResult> {
  try {
    const ctx = await requireStaffContext();
    const state = await discardThemeDraft(ctx);
    revalidatePath("/admin/theme");
    return { ok: true, state, message: "Draft discarded." };
  } catch (err) {
    return failFrom(err);
  }
}

/** Uploads a logo file and returns its path; the builder then puts it in the draft. */
export async function uploadThemeLogoAction(formData: FormData): Promise<{ ok: true; path: string } | Failure> {
  const file = formData.get("logo");
  if (!(file instanceof File)) return fail("Choose an image file.");
  if (file.size > LOGO_MAX_BYTES) return fail("The logo must be 2 MB or smaller.");
  try {
    const ctx = await requireStaffContext();
    const path = await storeThemeLogo(ctx, new Uint8Array(await file.arrayBuffer()));
    return { ok: true, path };
  } catch (err) {
    return failFrom(err);
  }
}
