"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, formString, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { anonymizeCustomer, updateCustomer } from "@/server/customers";
import { failFromError } from "../../orders/_lib/errors";
import { customerCopy as t } from "../_copy";

const profileSchema = z.object({
  firstName: z.string().trim().max(100, "Keep the first name under 100 characters."),
  lastName: z.string().trim().max(100, "Keep the last name under 100 characters."),
  email: z.union([z.literal(""), z.email("Enter a valid email address.").max(254)]),
  phone: z.string().trim().max(40, "Keep the phone number under 40 characters."),
  notes: z.string().trim().max(5000, "Keep the notes under 5,000 characters."),
});

export async function updateCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  const parsed = profileSchema.safeParse({
    firstName: formString(formData, "firstName"),
    lastName: formString(formData, "lastName"),
    email: formString(formData, "email").toLowerCase(),
    phone: formString(formData, "phone"),
    notes: formString(formData, "notes"),
  });
  if (!parsed.success) return actionFail("Check the highlighted fields.", zodFieldErrors(parsed.error));
  const { email, ...rest } = parsed.data;
  // The email field is only rendered (and so only submitted) for guests; registered emails stay as they are.
  const emailEditable = formData.has("email");
  if (emailEditable && !email)
    return actionFail("Check the highlighted fields.", {
      email: ["Enter an email address."],
    });
  try {
    const ctx = await requireStaffContext();
    await updateCustomer(ctx, id, {
      firstName: rest.firstName || null,
      lastName: rest.lastName || null,
      phone: rest.phone || null,
      notes: rest.notes || null,
      ...(emailEditable ? { email } : {}),
    });
    revalidatePath(`/admin/customers/${id}`);
    revalidatePath("/admin/customers");
    return actionOk(t.profile.saved);
  } catch (error) {
    const result = failFromError(error, t.notFound);
    if (!result.ok && result.message?.toLowerCase().includes("email")) {
      return actionFail(result.message, { email: [result.message] });
    }
    return result;
  }
}

export async function anonymizeCustomerAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  try {
    const ctx = await requireStaffContext();
    const result = await anonymizeCustomer(ctx, id);
    revalidatePath(`/admin/customers/${id}`);
    revalidatePath("/admin/customers");
    revalidatePath("/admin/orders", "layout");
    return actionOk(result.alreadyAnonymized ? t.anonymize.already : t.anonymize.done);
  } catch (error) {
    return failFromError(error, t.notFound);
  }
}
