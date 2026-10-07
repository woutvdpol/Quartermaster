"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { toast, toasterOwners, toastStore, type ToastItem, type ToastTone } from "./toast-store";

const t = getDictionary().ui.toast;

const toneClass: Record<ToastTone, string> = {
  info: "border-l-info",
  ok: "border-l-ok",
  warn: "border-l-warn",
  crit: "border-l-crit",
};
const toneMark: Record<ToastTone, { mark: string; cls: string }> = {
  info: { mark: "i", cls: "text-info" },
  ok: { mark: "✓", cls: "text-ok" },
  warn: { mark: "!", cls: "text-warn" },
  crit: { mark: "!", cls: "text-crit" },
};

/**
 * Renders toasts from `toast()`. Mount once inside the admin theme root, e.g. in
 * src/app/admin/(app)/layout.tsx next to <main>. Extra instances render nothing.
 */
export function Toaster() {
  const id = useId();
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getServerSnapshot);
  const isOwner = useSyncExternalStore(
    toasterOwners.subscribe,
    () => toasterOwners.first() === id,
    () => false,
  );
  useEffect(() => {
    toasterOwners.register(id);
    return () => toasterOwners.unregister(id);
  }, [id]);

  if (!isOwner) return null;
  return (
    <section
      aria-label={t.region}
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] grid w-[min(360px,calc(100vw-2rem))] gap-2"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
      <style>{`@keyframes qm-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>
    </section>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (item.duration === 0 || paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => toast.dismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [item.id, item.duration, paused]);

  const mark = toneMark[item.tone];
  return (
    <div
      role={item.tone === "crit" ? "alert" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cx(
        "pointer-events-auto flex items-start gap-2.5 rounded-card border border-l-4 border-line bg-panel px-3 py-2.5 text-[13px] text-ink shadow-pop",
        "motion-safe:animate-[qm-toast-in_160ms_ease-out]",
        toneClass[item.tone],
      )}
    >
      <span aria-hidden="true" className={cx("mt-px font-mono text-xs font-semibold", mark.cls)}>
        {mark.mark}
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="font-medium">{item.title}</p>
        {item.description && <p className="text-xs text-muted">{item.description}</p>}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              toast.dismiss(item.id);
            }}
            className="justify-self-start text-xs font-medium text-accent underline underline-offset-2 hover:text-accent-strong"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(item.id)}
        aria-label={t.dismiss}
        className="-mt-0.5 -mr-1 grid size-6 shrink-0 place-items-center rounded-control text-muted hover:bg-panel-2 hover:text-ink"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

/**
 * Toasts an ActionResult message whenever a new result arrives:
 *   const [state, action] = useActionState(save, null);
 *   <ActionToast state={state} />
 * Success → ok toast; failure without field errors → crit toast (field errors stay inline).
 */
export function ActionToast({
  state,
  errors = true,
}: {
  state: { ok: boolean; message?: string; fieldErrors?: unknown } | null | undefined;
  /** Also toast failures (default true). Set false if you render <ActionMessage/> for errors. */
  errors?: boolean;
}) {
  useEffect(() => {
    if (!state?.message) return;
    if (state.ok) toast.ok(state.message);
    else if (errors) toast.crit(state.message);
  }, [state, errors]);
  return null;
}
