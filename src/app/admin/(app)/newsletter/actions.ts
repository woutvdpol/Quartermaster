"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  actionFail,
  actionOk,
  formString,
  type ActionResult,
  type ActionState,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  campaignBodyHtml,
  createCampaign,
  deleteCampaign,
  deleteSubscribers,
  sendCampaign,
  sendTestCampaign,
  updateCampaign,
} from "@/server/newsletter";
import { copy } from "./_copy";
import { failFrom } from "./_lib/errors";

const BASE = "/admin/newsletter";
const MAX_BODY = 65_535;

function campaignPath(id: string) {
  return `${BASE}/campaigns/${id}`;
}

type CampaignField = "subject" | "body";

function readCampaign(formData: FormData) {
  return {
    subject: formString(formData, "subject"),
    body: formString(formData, "body"),
  };
}

function validateCampaign(input: {
  subject: string;
  body: string;
}): ActionResult<CampaignField> | null {
  const fieldErrors: Partial<Record<CampaignField, string[]>> = {};
  if (!input.subject) fieldErrors.subject = ["Enter a subject."];
  else if (input.subject.length > 200)
    fieldErrors.subject = ["Keep the subject under 200 characters."];
  if (!input.body) fieldErrors.body = ["Write some content."];
  else if (input.body.length > MAX_BODY)
    fieldErrors.body = ["The content is too long."];
  return Object.keys(fieldErrors).length
    ? actionFail("Check the highlighted fields.", fieldErrors)
    : null;
}

/** Creates (no `id`) or updates a draft. A new draft opens in its own editor URL. */
export async function saveCampaignAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const id = formString(formData, "id");
  const input = readCampaign(formData);
  const invalid = validateCampaign(input);
  if (invalid) return invalid;

  let createdId: string | null = null;
  try {
    const ctx = await requireStaffContext();
    if (id) {
      await updateCampaign(ctx, id, input);
    } else {
      createdId = (await createCampaign(ctx, input)).id;
    }
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  if (createdId) redirect(campaignPath(createdId));
  revalidatePath(campaignPath(id));
  return actionOk(copy.editor.saved);
}

/**
 * Live preview: the same sanitizing Markdown renderer the mail uses. Read-only, but still a staff
 * action (no anonymous access to the renderer).
 */
export async function previewCampaignAction(
  body: string,
): Promise<{ ok: boolean; html: string }> {
  try {
    await requireStaffContext();
    if (typeof body !== "string" || body.length > MAX_BODY)
      return { ok: false, html: "" };
    return { ok: true, html: campaignBodyHtml(body) };
  } catch {
    return { ok: false, html: "" };
  }
}

export async function sendTestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const id = formString(formData, "id");
  const email = formString(formData, "email");
  if (!email)
    return actionFail("Enter an email address.", {
      email: ["Enter an email address."],
    });
  try {
    const ctx = await requireStaffContext();
    await sendTestCampaign(ctx, id, email);
  } catch (err) {
    const result = failFrom(err);
    if (!result.ok && /email/i.test(result.message ?? ""))
      return actionFail(result.message, { email: [result.message ?? ""] });
    return result;
  }
  return actionOk(copy.test.sent(email.toLowerCase()));
}

/** Irreversible: freezes the recipient list and queues the fan-out (ConfirmDialog in the UI). */
export async function sendCampaignAction(
  formData: FormData,
): Promise<ActionResult> {
  const id = formString(formData, "id");
  if (!id) return actionFail();
  let recipients = 0;
  try {
    const ctx = await requireStaffContext();
    recipients = (await sendCampaign(ctx, id)).recipientCount;
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  revalidatePath(campaignPath(id));
  return actionOk(copy.send.done(recipients));
}

export async function deleteCampaignAction(
  formData: FormData,
): Promise<ActionResult> {
  const id = formString(formData, "id");
  if (!id) return actionFail();
  try {
    const ctx = await requireStaffContext();
    await deleteCampaign(ctx, id);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  redirect(BASE);
}

/** Hard delete of the selected subscribers (GDPR erasure). */
export async function deleteSubscribersAction(
  formData: FormData,
): Promise<ActionResult> {
  const ids = formData
    .getAll("ids")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return actionFail("Select at least one subscriber.");
  if (ids.length > 1000)
    return actionFail("Delete at most 1,000 subscribers at a time.");
  let count = 0;
  try {
    const ctx = await requireStaffContext();
    count = await deleteSubscribers(ctx, ids);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  return actionOk(copy.subscribers.deleted(count));
}
