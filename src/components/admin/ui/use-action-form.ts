"use client";

import { useActionState } from "react";
import { fieldError, type ActionResult, type ActionState } from "./form";

/**
 * useActionState preset for server actions returning ActionResult:
 *
 *   const { state, formAction, pending, error } = useActionForm(saveProduct);
 *   <form action={formAction}>
 *     <TextInput label="Title" name="title" error={error("title")} />
 *
 * The action's signature is `(prev: ActionState, formData: FormData) => Promise<ActionResult>`.
 */
export function useActionForm<F extends string = string, D = unknown>(
  action: (prev: ActionState<F, D>, formData: FormData) => Promise<ActionResult<F, D>>,
  initialState: ActionState<F, D> = null,
) {
  const [state, formAction, pending] = useActionState<ActionState<F, D>, FormData>(action, initialState);
  return {
    state,
    formAction,
    pending,
    /** First error for a field, for a control's `error` prop. */
    error: (name: F) => fieldError(state, name),
  };
}
