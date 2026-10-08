"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  applyShippingTemplate,
  assertSetupActor,
  chooseImport,
  completeSetup,
  createLegalPages,
  isSetupStepKey,
  markSetupStep,
  nextStep,
  requestOwnDomain,
  saveBasicsStep,
  saveBusinessStep,
  SETUP_STEPS,
  type ImportChoice,
  type LegalPageKey,
  type SetupStepKey,
  type ShippingTemplate,
} from "@/server/onboarding";
import { saveMollieKey } from "@/server/payments/mollie-config";
// Side effect: mail hooks (superadmin notices are queued through the mail API).
import "@/server/mail/hooks";
import { fail, failFrom } from "../_system/errors";

const BASE = "/admin/setup";

async function setupContext() {
  const ctx = await requireStaffContext();
  assertSetupActor(ctx);
  return ctx;
}

function stepUrl(step: SetupStepKey | null): string {
  return step ? `${BASE}?step=${step}` : BASE;
}

/** Done / skip buttons (steps without their own form, and "Skip for now" everywhere). */
export async function markStepAction(formData: FormData): Promise<void> {
  const step = formString(formData, "step");
  const status = formString(formData, "status") === "skipped" ? "skipped" : "done";
  if (!isSetupStepKey(step)) return;
  const def = SETUP_STEPS.find((s) => s.key === step)!;
  if (status === "skipped" && !def.skippable) return;
  const ctx = await setupContext();
  await markSetupStep(ctx, step, status);
  revalidatePath(BASE);
  redirect(stepUrl(nextStep(step)));
}

export async function saveBasicsAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await setupContext();
    await saveBasicsStep(ctx, {
      shopName: formString(formData, "shopName"),
      contactEmail: formString(formData, "contactEmail"),
      displayCurrencies: formData.getAll("displayCurrencies").filter((v): v is string => typeof v === "string") as never,
    });
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath("/admin", "layout");
  redirect(stepUrl("business"));
}

export async function saveBusinessAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await setupContext();
    await saveBusinessStep(ctx, {
      cocNumber: formString(formData, "cocNumber"),
      vatNumber: formString(formData, "vatNumber"),
      iban: formString(formData, "iban"),
      phone: formString(formData, "phone"),
      line1: formString(formData, "line1"),
      line2: formString(formData, "line2"),
      postalCode: formString(formData, "postalCode"),
      city: formString(formData, "city"),
      country: formString(formData, "country"),
    });
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  redirect(stepUrl("look"));
}

/** Same service as the payment-methods page; refreshes the wizard instead. */
export async function saveMollieKeyStepAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const key = formString(formData, "apiKey");
  if (!key) return fail("Check the highlighted fields.", { apiKey: ["Paste your Mollie API key."] });
  try {
    const ctx = await setupContext();
    const status = await saveMollieKey(ctx, key);
    revalidatePath(BASE);
    revalidatePath("/admin/payment-methods");
    return actionOk(`Mollie connected in ${status.mode === "live" ? "live" : "test"} mode.`);
  } catch (err) {
    const failure = failFrom(err);
    return fail(failure.message, failure.fieldErrors ?? { apiKey: [failure.message ?? "This key was not accepted."] });
  }
}

export async function applyShippingTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const template = formString(formData, "template");
  if (!template) return fail("Choose a template.", { template: ["Choose a template."] });
  try {
    const ctx = await setupContext();
    await applyShippingTemplate(ctx, template as ShippingTemplate);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  revalidatePath("/admin/shipping");
  redirect(stepUrl("import"));
}

export async function chooseImportAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const choice = formString(formData, "choice");
  if (!choice) return fail("Choose how you want to bring your products.", { choice: ["Choose an option."] });
  try {
    const ctx = await setupContext();
    await chooseImport(ctx, choice as ImportChoice, formString(formData, "note") || undefined);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  redirect(stepUrl("import"));
}

/** Called by the embedded ProductImport when a CSV import finished: records the step as done. */
export async function recordImportAction(source: string): Promise<ActionResult> {
  const choice = source === "shopify" ? "shopify" : source === "woocommerce" ? "woocommerce" : null;
  if (!choice) return fail("Unknown import source.");
  try {
    const ctx = await setupContext();
    await chooseImport(ctx, choice);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  return actionOk("Import recorded.");
}

export async function createLegalPagesAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const keys = formData.getAll("pages").filter((v): v is string => typeof v === "string") as LegalPageKey[];
  if (keys.length === 0) return fail("Choose at least one page.", { pages: ["Choose at least one page."] });
  try {
    const ctx = await setupContext();
    await createLegalPages(ctx, keys);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  revalidatePath("/admin/pages");
  redirect(stepUrl("golive"));
}

export async function requestDomainAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await setupContext();
    const host = await requestOwnDomain(ctx, formString(formData, "domain"));
    revalidatePath(BASE);
    return actionOk(`Request for ${host} sent. We connect it once your DNS record is in place.`);
  } catch (err) {
    return failFrom(err);
  }
}

export async function goLiveAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await setupContext();
    await completeSetup(ctx, { acknowledgeWarnings: formData.get("acknowledge") === "on" });
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath("/admin", "layout");
  redirect("/admin/dashboard?setup=done");
}
