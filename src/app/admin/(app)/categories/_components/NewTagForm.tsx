"use client";

import { useEffect, useRef } from "react";
import { ActionToast, SubmitButton, TextInput, useActionForm } from "@/components/admin/ui";
import { copy } from "../_copy";
import { createTagAction } from "../actions";

const t = copy.tags;

/** Inline "add tag" form in the tags toolbar. */
export function NewTagForm() {
  const { state, formAction, error } = useActionForm(createTagAction);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.querySelector<HTMLInputElement>("input[name=name]")?.focus();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex items-start gap-2" noValidate>
      <ActionToast state={state} errors={false} />
      <TextInput
        label={t.new}
        labelHidden
        name="name"
        placeholder={t.newPlaceholder}
        maxLength={100}
        required
        error={error("name")}
        className="w-60"
        autoComplete="off"
      />
      <SubmitButton size="sm" variant="primary" className="mt-[3px]">
        {t.add}
      </SubmitButton>
    </form>
  );
}
