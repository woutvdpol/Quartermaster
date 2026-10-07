/*
 * Server action result convention for admin forms (see README → "Forms with server actions").
 *
 *   "use server";
 *   export async function saveProduct(_prev: ActionState, formData: FormData): Promise<ActionResult> {
 *     const parsed = schema.safeParse(…);
 *     if (!parsed.success) return actionFail("Check the highlighted fields.", zodFieldErrors(parsed.error));
 *     …
 *     return actionOk("Product saved.");
 *   }
 *
 * Plain module (no "use client"/"use server"): import it from actions and from client forms.
 */

export type FieldErrors<F extends string = string> = Partial<Record<F, string[]>>;

export type ActionResult<F extends string = string, D = unknown> =
  | { ok: true; message?: string; data?: D; fieldErrors?: undefined }
  | { ok: false; message?: string; fieldErrors?: FieldErrors<F> };

/** `useActionState` state: `null` before the first submit. */
export type ActionState<F extends string = string, D = unknown> = ActionResult<F, D> | null;

export function actionOk<D = unknown>(message?: string, data?: D): ActionResult<never, D> {
  return { ok: true, message, data };
}

export function actionFail<F extends string = string>(message?: string, fieldErrors?: FieldErrors<F>): ActionResult<F> {
  return { ok: false, message, fieldErrors };
}

/** First error message for a field, for a control's `error` prop. */
export function fieldError<F extends string>(
  state: ActionState<F, unknown> | undefined,
  name: F,
): string | undefined {
  if (!state || state.ok) return undefined;
  return state.fieldErrors?.[name]?.[0];
}

/**
 * Field errors from a zod (v4) error without importing zod: `zodFieldErrors(parsed.error)`.
 * Nested paths are joined with "." (e.g. "variants.0.price").
 */
export function zodFieldErrors(error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> }): FieldErrors {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Read a trimmed string from FormData ("" when missing or a File). */
export function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
