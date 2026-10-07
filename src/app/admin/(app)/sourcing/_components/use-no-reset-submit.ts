"use client";

import { startTransition, type FormEvent } from "react";

/**
 * Submits a form to a useActionState action without React's automatic form reset, so a failed
 * submit keeps what the user typed (drawer forms with many fields).
 */
export function useNoResetSubmit(formAction: (formData: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };
}
