"use server";

import { revalidatePath } from "next/cache";
import { actionOk, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  addSuggestedTerms,
  approveMany,
  approveTranslation,
  deleteGlossaryTerm,
  queueExisting,
  retranslateUnreviewed,
  saveGlossaryTerm,
  suggestTranslation,
  withdrawTranslation,
} from "@/server/translations/service";
import type { TranslationEntityName, TranslationLocale } from "@/server/translations/fields";
import { failFrom } from "../_system/errors";

/*
 * Server actions of the translation review (queue page, product editor card, glossary, settings).
 * All validation happens in the service (src/server/translations/service.ts).
 */

export type CellRef = { entity: TranslationEntityName; entityId: string; field: string; locale: TranslationLocale };

function refresh(ref?: { entity: TranslationEntityName; entityId: string }) {
  revalidatePath("/admin/translations", "layout");
  if (ref?.entity === "PRODUCT") revalidatePath(`/admin/inventory/${ref.entityId}`);
}

export async function approveTranslationAction(ref: CellRef, value: string): Promise<ActionResult> {
  try {
    await approveTranslation(await requireStaffContext(), { ...ref, value });
    refresh(ref);
    return actionOk("Approved — this translation is now online.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function withdrawTranslationAction(ref: CellRef): Promise<ActionResult> {
  try {
    await withdrawTranslation(await requireStaffContext(), ref);
    refresh(ref);
    return actionOk("Taken offline. Visitors see English for this text again.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function suggestTranslationAction(ref: CellRef): Promise<ActionResult<string, { value: string; missing: number; stored: boolean }>> {
  try {
    const out = await suggestTranslation(await requireStaffContext(), ref);
    if (out.stored) refresh(ref);
    return actionOk(out.missing ? "Translated — some codes or terms may be missing, please check." : "Translated. Check it, then approve.", out);
  } catch (err) {
    return failFrom(err);
  }
}

export async function approveManyAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ids = formData.getAll("ids").filter((v): v is string => typeof v === "string");
    const { approved, skipped } = await approveMany(await requireStaffContext(), ids);
    refresh();
    return actionOk(`${approved} approved${skipped ? `, ${skipped} skipped (no proposal yet)` : ""}.`);
  } catch (err) {
    return failFrom(err);
  }
}

export async function retranslateAction(locale: TranslationLocale): Promise<ActionResult> {
  try {
    const { queued } = await retranslateUnreviewed(await requireStaffContext(), locale);
    refresh();
    return actionOk(queued ? `${queued} unreviewed translations queued again.` : "Nothing to translate again.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function queueExistingAction(includeSold: boolean): Promise<ActionResult> {
  try {
    await queueExisting(await requireStaffContext(), { includeSold: includeSold === true });
    refresh();
    revalidatePath("/admin/settings/i18n");
    return actionOk("Queued. Translations appear in the review list as they are done.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function saveTermAction(input: { locale: TranslationLocale; source: string; target: string | null }): Promise<ActionResult> {
  try {
    await saveGlossaryTerm(await requireStaffContext(), input);
    revalidatePath("/admin/translations/glossary");
    return actionOk("Term saved. It applies to new machine translations.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function deleteTermAction(id: string): Promise<ActionResult> {
  try {
    await deleteGlossaryTerm(await requireStaffContext(), id);
    revalidatePath("/admin/translations/glossary");
    return actionOk("Term removed.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function addSuggestedTermsAction(locale: TranslationLocale): Promise<ActionResult> {
  try {
    const { added } = await addSuggestedTerms(await requireStaffContext(), locale);
    revalidatePath("/admin/translations/glossary");
    return actionOk(added ? `${added} terms added.` : "All suggested terms are already in the glossary.");
  } catch (err) {
    return failFrom(err);
  }
}
