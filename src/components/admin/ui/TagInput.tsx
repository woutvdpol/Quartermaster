"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { Field, type FieldBaseProps } from "./Field";

const t = getDictionary().ui.tags;

export type TagInputProps = FieldBaseProps & {
  /** Each tag is submitted as its own `name` entry: `formData.getAll(name)`. */
  name: string;
  defaultValue?: string[];
  value?: string[];
  onValueChange?: (tags: string[]) => void;
  placeholder?: string;
  /** Offered via a native datalist while typing. */
  suggestions?: string[];
  maxTags?: number;
  /** Normalise a typed tag (e.g. lower-case). Return "" to reject it. */
  normalize?: (tag: string) => string;
  disabled?: boolean;
};

/** Chips + text input. Enter or comma adds a tag, Backspace on an empty input removes the last one. */
export function TagInput({
  name,
  defaultValue = [],
  value,
  onValueChange,
  placeholder,
  suggestions,
  maxTags,
  normalize = (s) => s.trim(),
  disabled,
  hint,
  ...field
}: TagInputProps) {
  const [internal, setInternal] = useState<string[]>(defaultValue);
  const tags = value ?? internal;
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `tags${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const full = maxTags !== undefined && tags.length >= maxTags;

  function commit(next: string[]) {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  }

  function add(raw: string) {
    const tag = normalize(raw);
    if (!tag || full) return;
    if (tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      setDraft("");
      return;
    }
    commit([...tags, tag]);
    setDraft("");
    setAnnouncement(t.added(tag));
  }

  function remove(index: number) {
    const tag = tags[index];
    commit(tags.filter((_, i) => i !== index));
    setAnnouncement(t.removed(tag));
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      if (draft.trim()) {
        e.preventDefault();
        add(draft);
      } else if (e.key === ",") e.preventDefault();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      remove(tags.length - 1);
    }
  }

  return (
    <Field {...field} hint={hint ?? (full && maxTags ? t.limit(maxTags) : t.hint)}>
      {(control) => (
        <div
          className={cx(
            "flex min-h-[35px] flex-wrap items-center gap-1.5 rounded-control border bg-panel px-1.5 py-1 transition-colors",
            "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
            control["aria-invalid"] ? "border-crit" : "border-line hover:border-line-strong",
            disabled && "bg-panel-2 opacity-60",
          )}
          onClick={(e) => {
            if (e.target === e.currentTarget) inputRef.current?.focus();
          }}
        >
          <ul className="contents" aria-label={typeof field.label === "string" ? field.label : undefined}>
            {tags.map((tag, i) => (
              <li
                key={tag}
                className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-panel-2 py-px pr-0.5 pl-2 text-xs text-ink"
              >
                {tag}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(i)}
                  aria-label={t.remove(tag)}
                  className="grid size-4 place-items-center rounded-[3px] text-muted hover:bg-panel-3 hover:text-ink"
                >
                  <span aria-hidden="true">×</span>
                </button>
                <input type="hidden" name={name} value={tag} />
              </li>
            ))}
          </ul>
          <input
            {...control}
            required={control.required && tags.length === 0}
            ref={inputRef}
            type="text"
            value={draft}
            disabled={disabled || full}
            placeholder={tags.length === 0 ? placeholder : undefined}
            list={suggestions?.length ? listId : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => draft.trim() && add(draft)}
            className="min-w-[8ch] flex-1 border-0 bg-transparent px-1 py-0.5 text-[13.5px] text-ink placeholder:text-muted focus-visible:outline-none"
          />
          {suggestions?.length ? (
            <datalist id={listId}>
              {suggestions
                .filter((s) => !tags.includes(s))
                .map((s) => (
                  <option key={s} value={s} />
                ))}
            </datalist>
          ) : null}
          <span role="status" className="sr-only">
            {announcement}
          </span>
        </div>
      )}
    </Field>
  );
}
