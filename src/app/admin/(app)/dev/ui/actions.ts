"use server";

import { z } from "zod";
import { actionFail, actionOk, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";

/* Demo actions for the UI kit kitchen sink. Disabled in production. */

const schema = z.object({
  title: z.string().trim().min(3, "Enter a title of at least 3 characters."),
  price: z.coerce.number().int().positive("Enter a price above zero."),
  condition: z.enum(["mint", "good", "worn"], { message: "Choose a condition." }),
  tags: z.array(z.string()).max(8),
});

export async function demoSaveAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  if (process.env.NODE_ENV === "production") return actionFail("Not available.");
  await new Promise((r) => setTimeout(r, 600));
  const parsed = schema.safeParse({
    title: formData.get("title"),
    price: formData.get("price") || undefined,
    condition: formData.get("condition") ?? undefined,
    tags: formData.getAll("tags"),
  });
  if (!parsed.success) return actionFail("Check the highlighted fields.", zodFieldErrors(parsed.error));
  return actionOk(`Saved “${parsed.data.title}” at ${parsed.data.price} cents.`);
}

export async function demoArchiveAction(formData: FormData): Promise<ActionResult> {
  if (process.env.NODE_ENV === "production") return actionFail("Not available.");
  await new Promise((r) => setTimeout(r, 500));
  if (formData.get("reason") === "fail") return actionFail("The archive failed (demo). Try another reason.");
  return actionOk(`Item ${String(formData.get("id"))} archived (demo).`);
}

export async function demoBulkAction(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  console.info("[dev/ui] bulk", formData.get("op"), formData.getAll("ids"));
}
