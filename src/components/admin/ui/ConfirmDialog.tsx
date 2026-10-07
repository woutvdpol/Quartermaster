"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "../Button";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { dialogBase } from "./dialog-styles";
import { InlineAlert } from "./InlineAlert";
import { SubmitButton } from "./SubmitButton";
import { toast } from "./toast-store";

const t = getDictionary().ui.dialog;

type ActionLike = (formData: FormData) => unknown;

export type ConfirmDialogProps = {
  /** Label of the button that opens the dialog. */
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerClassName?: string;
  /** Accessible label for icon-only triggers. */
  triggerLabel?: string;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  /** "danger" for destructive or irreversible actions (archive, delete, refund). */
  tone?: "danger" | "primary";
  /**
   * Form action run on confirm: a server action or client function receiving FormData (with
   * `fields` + any inputs in `children`). If it returns `{ ok: false, message }` the dialog stays
   * open and shows the message; `{ ok: true, message }` closes it and shows a toast.
   */
  action?: ActionLike;
  /** Hidden inputs submitted with the action, e.g. { id: product.id }. */
  fields?: Record<string, string>;
  /** Extra form controls inside the dialog (e.g. a reason textarea). */
  children?: ReactNode;
  disabled?: boolean;
};

/**
 * Confirmation for destructive or irreversible actions, on a native modal <dialog> (focus stays
 * inside, Esc cancels, focus returns to the trigger). Cancel is focused first.
 */
export function ConfirmDialog({
  trigger,
  triggerVariant,
  triggerSize = "md",
  triggerClassName,
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel = t.cancel,
  pendingLabel = t.working,
  tone = "danger",
  action,
  fields,
  children,
  disabled,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;

  function open() {
    setError(null);
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  function close() {
    dialogRef.current?.close();
  }

  async function confirm(formData: FormData) {
    setError(null);
    const result = (await action?.(formData)) as { ok?: boolean; message?: string } | undefined;
    if (result && typeof result === "object" && result.ok === false) {
      setError(result.message ?? null);
      return;
    }
    close();
    if (result && typeof result === "object" && result.ok && result.message) toast.ok(result.message);
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={buttonClasses({
          variant: triggerVariant ?? (tone === "danger" ? "danger" : "secondary"),
          size: triggerSize,
          className: triggerClassName,
        })}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={open}
      >
        {trigger}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onClose={() => triggerRef.current?.focus()}
        className={cx(dialogBase, "m-auto w-[min(440px,calc(100vw-2rem))] rounded-card border border-line")}
      >
        <form action={confirm} className="grid gap-3 p-4">
          <h2 id={titleId} className="type-display text-lg">
            {title}
          </h2>
          {description && (
            <div id={descId} className="text-[13.5px] text-ink-2">
              {description}
            </div>
          )}
          {fields && Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          {children}
          {error && (
            <InlineAlert tone="crit" live="alert">
              {error}
            </InlineAlert>
          )}
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <button type="button" ref={cancelRef} className={buttonClasses()} onClick={close}>
              {cancelLabel}
            </button>
            <SubmitButton variant={tone === "danger" ? "danger" : "primary"} pendingLabel={pendingLabel}>
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
