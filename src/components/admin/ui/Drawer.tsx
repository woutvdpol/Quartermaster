"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "../Button";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { dialogBase } from "./dialog-styles";

const t = getDictionary().ui.dialog;

export type DrawerProps = {
  title: ReactNode;
  /** Small text under the title (e.g. SKU, order number). */
  description?: ReactNode;
  children: ReactNode;
  /** Sticky footer, typically FormActions-like buttons. */
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
  /** Controlled open state. Omit together with onOpenChange to use `trigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled: label of a button that opens the drawer. */
  trigger?: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  /** Close when the backdrop is clicked (default true). */
  dismissible?: boolean;
};

const widths = { md: "w-[min(480px,100vw)]", lg: "w-[min(640px,100vw)]", xl: "w-[min(860px,100vw)]" };

/**
 * Right-hand side panel on a modal <dialog> (design C detail panels): Esc and the close button
 * close it, focus is contained by the dialog and returns to the opener.
 */
export function Drawer({
  title,
  description,
  children,
  footer,
  size = "md",
  open: openProp,
  onOpenChange,
  trigger,
  triggerVariant = "secondary",
  triggerSize = "md",
  dismissible = true,
}: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;

  function setOpen(next: boolean) {
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  // Sync the native dialog with the open state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      {trigger !== undefined && (
        <button
          type="button"
          aria-haspopup="dialog"
          className={buttonClasses({ variant: triggerVariant, size: triggerSize })}
          onClick={() => setOpen(true)}
        >
          {trigger}
        </button>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onClose={() => open && setOpen(false)}
        onClick={(e) => {
          if (dismissible && e.target === e.currentTarget) setOpen(false);
        }}
        className={cx(
          dialogBase,
          "my-0 mr-0 ml-auto h-dvh max-h-dvh max-w-full border-l border-line starting:open:translate-x-6",
          widths[size],
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
            <div className="min-w-0">
              <h2 id={titleId} className="type-display text-lg">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-0.5 text-xs text-muted">
                  {description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.close}
              className="grid size-8 shrink-0 place-items-center rounded-control text-lg text-muted hover:bg-panel-2 hover:text-ink"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-panel px-4 py-3">{footer}</footer>}
        </div>
      </dialog>
    </>
  );
}
