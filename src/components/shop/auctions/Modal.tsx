"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Small modal on the platform <dialog> (focus trap, Esc and inert background for free). Open while
 * `open` is true; Esc / backdrop click call `onClose`. Bottom sheet on phones, centred from sm.
 */
export function Modal({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-shop bg-shop-surface p-0 text-shop-ink shadow-shop-pop backdrop:bg-shop-scrim sm:m-auto sm:max-w-md sm:rounded-shop"
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">{children}</div>
    </dialog>
  );
}
