"use client";

import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type Ref } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";

const t = getDictionary().ui.fileInput;

export type FileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> & {
  ref?: Ref<HTMLInputElement>;
};

/*
 * File picker with our own English "Choose file" button. The native control renders its button and
 * "no file chosen" text in the browser's language, so it stays in the DOM (visually hidden, still
 * focusable and submitted with the form) and we draw the visible part ourselves.
 */
export function FileInput({ ref, className, onChange, disabled, multiple, ...input }: FileInputProps) {
  const inner = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  // A form reset clears the native value; mirror that in the label.
  useEffect(() => {
    const form = inner.current?.form;
    if (!form) return;
    const onReset = () => setLabel(null);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  function setRefs(node: HTMLInputElement | null) {
    inner.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.currentTarget.files;
    setLabel(!files || files.length === 0 ? null : files.length === 1 ? files[0].name : t.many(files.length));
    onChange?.(e);
  }

  return (
    <span className={cx("flex min-w-0 items-center gap-3", className)}>
      <input
        {...input}
        ref={setRefs}
        type="file"
        multiple={multiple}
        disabled={disabled}
        onChange={handleChange}
        className="peer sr-only"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onClick={() => inner.current?.click()}
        className={cx(
          "shrink-0 rounded-control border border-line bg-panel-2 px-3 py-1.5 text-[13px] text-ink transition-colors",
          "hover:border-line-strong disabled:cursor-not-allowed disabled:text-muted",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
          "peer-aria-invalid:border-crit",
        )}
      >
        {multiple ? t.chooseMany : t.choose}
      </button>
      <span aria-hidden="true" className={cx("min-w-0 truncate text-[13px]", label ? "text-ink" : "text-muted")}>
        {label ?? t.none}
      </span>
    </span>
  );
}
