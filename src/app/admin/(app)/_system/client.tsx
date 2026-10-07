"use client";

import { startTransition, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Button,
  Spinner,
  TextInput,
  toast,
  useActionForm,
  type ActionResult,
  type ActionState,
  type ButtonProps,
} from "@/components/admin/ui";

/*
 * Small client helpers shared by the system screens. Not in the kit on purpose (screen-specific).
 */

type FormAction<D> = (prev: ActionState<string, D>, formData: FormData) => Promise<ActionResult<string, D>>;

/**
 * Like the kit's `useActionForm`, but submits via onSubmit + startTransition so React does NOT
 * reset the form after the action: typed values survive a failed (validation) submit.
 * Pair the form with <PendingButton pending={pending}> (useFormStatus does not see this submit).
 */
export function useKeepForm<D = unknown>(action: FormAction<D>, opts: { onSuccess?: (state: ActionResult<string, D>) => void } = {}) {
  const { state, formAction, pending, error } = useActionForm<string, D>(action);
  const onSuccess = useRef(opts.onSuccess);
  useEffect(() => {
    onSuccess.current = opts.onSuccess;
  });
  const handled = useRef<ActionState<string, D>>(null);
  useEffect(() => {
    if (state && state !== handled.current) {
      handled.current = state;
      if (state.ok) onSuccess.current?.(state);
    }
  }, [state]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter && "form" in submitter ? submitter : null);
    startTransition(() => formAction(fd));
  }
  return { state, pending, error, onSubmit };
}

/** Submit button with an explicit pending flag (for useKeepForm forms). */
export function PendingButton({
  pending,
  pendingLabel = "Saving…",
  children,
  variant = "primary",
  disabled,
  ...props
}: Omit<ButtonProps, "type"> & { pending: boolean; pendingLabel?: string }) {
  return (
    <Button type="submit" variant={variant} disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending && <Spinner />}
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Copies text to the clipboard with a toast. Falls back to selecting the text. */
export async function copyText(text: string, what = "Copied to clipboard."): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.ok(what);
    return true;
  } catch {
    toast.warn("Could not copy automatically. Select the text and copy it yourself.");
    return false;
  }
}

/** Read-only field with a Copy button (invite links, secrets). */
export function CopyField({
  label,
  value,
  hint,
  mono = true,
  copiedMessage,
}: {
  label: ReactNode;
  value: string;
  hint?: ReactNode;
  mono?: boolean;
  copiedMessage?: string;
}) {
  const id = `copy-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [copied, setCopied] = useState(false);
  return (
    <TextInput
      id={id}
      label={label}
      hint={hint}
      value={value}
      readOnly
      onFocus={(e) => e.currentTarget.select()}
      inputClassName={mono ? "font-mono text-[12.5px]" : undefined}
      trailing={
        <button
          type="button"
          className="-mx-2.5 h-full px-2.5 text-[12.5px] font-medium text-ink hover:bg-panel-3"
          onClick={async () => {
            const ok = await copyText(value, copiedMessage);
            if (!ok) (document.getElementById(id) as HTMLInputElement | null)?.select();
            setCopied(ok);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      }
    />
  );
}
