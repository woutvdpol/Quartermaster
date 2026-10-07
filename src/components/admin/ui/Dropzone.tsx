"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { FieldErrorText, firstError, RequiredMark } from "./Field";
import { hintClass, labelClass } from "./styles";

const t = getDictionary().ui.dropzone;

export type DropzoneItem = {
  /** Stable id: a media id for existing images, a generated id for new files. */
  id: string;
  /** Preview URL (object URL for new files). */
  url: string;
  name: string;
  /** Present for files added in this session (not yet uploaded). */
  file?: File;
  status?: "uploading" | "error";
  /** Error text when status is "error". */
  error?: string;
};

export type DropzoneProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | readonly string[] | null;
  required?: boolean;
  /** Controlled list (pair with onItemsChange). */
  items?: DropzoneItem[];
  /** Uncontrolled initial list, e.g. existing product media. */
  defaultItems?: DropzoneItem[];
  /** Every change: add, remove, reorder. */
  onItemsChange?: (items: DropzoneItem[]) => void;
  /** New, accepted files (start uploads here). `added` carries the generated ids. */
  onFilesAdded?: (files: File[], added: DropzoneItem[]) => void;
  onRemove?: (item: DropzoneItem) => void;
  /** New order of ids after a drag or move-button reorder. */
  onReorder?: (ids: string[]) => void;
  /** input accept syntax (default "image/*"). */
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  maxSizeBytes?: number;
  /** Optional plain-form fallback: new files are mirrored into a file input with this name… */
  name?: string;
  /** …and the id order into a hidden input with this name (comma separated). */
  orderName?: string;
  /** Mark the first image as the cover (default true). */
  cover?: boolean;
  /** Listen for ⌘V/Ctrl+V on the whole page ("document", default) or only when the zone has focus. */
  pasteScope?: "document" | "zone";
  disabled?: boolean;
  className?: string;
};

function matchesAccept(file: File, accept: string): boolean {
  if (!accept) return true;
  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);
    if (rule.endsWith("/*")) return file.type.toLowerCase().startsWith(rule.slice(0, -1));
    return file.type.toLowerCase() === rule;
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Image drop zone: drag & drop, paste (⌘V) and a file picker; previews in a grid with the first
 * image as cover; reorder by dragging or with the move buttons (keyboard). Generic: it reports
 * files and order via callbacks; uploading is up to the caller.
 */
export function Dropzone({
  label,
  hint,
  error,
  required,
  items: itemsProp,
  defaultItems = [],
  onItemsChange,
  onFilesAdded,
  onRemove,
  onReorder,
  accept = "image/*",
  multiple = true,
  maxFiles,
  maxSizeBytes,
  name,
  orderName,
  cover = true,
  pasteScope = "document",
  disabled = false,
  className,
}: DropzoneProps) {
  const [internal, setInternal] = useState<DropzoneItem[]>(defaultItems);
  const items = itemsProp ?? internal;
  const [dragActive, setDragActive] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rejections, setRejections] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const pickerRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const createdUrls = useRef(new Set<string>());
  const focusAfterMove = useRef<string | null>(null);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const message = firstError(error);
  const errorId = message ? `${baseId}-error` : undefined;

  function commit(next: DropzoneItem[]) {
    if (itemsProp === undefined) setInternal(next);
    onItemsChange?.(next);
  }

  function addFiles(list: FileList | File[]) {
    if (disabled) return;
    const files = Array.from(list);
    const problems: string[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      if (!matchesAccept(file, accept)) problems.push(t.wrongType(file.name));
      else if (maxSizeBytes && file.size > maxSizeBytes) problems.push(t.tooLarge(file.name, formatBytes(maxSizeBytes)));
      else accepted.push(file);
    }
    let room = maxFiles === undefined ? accepted.length : Math.max(0, maxFiles - items.length);
    if (!multiple) room = Math.min(room, 1);
    if (accepted.length > room) problems.push(t.tooMany(maxFiles ?? 1));
    const take = accepted.slice(0, room);
    setRejections(problems);
    if (take.length === 0) return;
    const added = take.map((file) => {
      const url = URL.createObjectURL(file);
      createdUrls.current.add(url);
      return { id: `new-${crypto.randomUUID()}`, url, name: file.name || "image", file } satisfies DropzoneItem;
    });
    commit(multiple ? [...items, ...added] : added);
    onFilesAdded?.(take, added);
    setAnnouncement(t.added(added.length));
  }

  function remove(item: DropzoneItem, index: number) {
    if (createdUrls.current.has(item.url)) {
      URL.revokeObjectURL(item.url);
      createdUrls.current.delete(item.url);
    }
    const next = items.filter((i) => i.id !== item.id);
    commit(next);
    onRemove?.(item);
    setAnnouncement(t.removedFile(item.name));
    // Keep keyboard focus in the list: next item's remove button, or the picker.
    const neighbour = next[Math.min(index, next.length - 1)];
    focusAfterMove.current = neighbour ? `remove:${neighbour.id}` : "picker";
  }

  function move(from: number, to: number, focusKey?: string) {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
    onReorder?.(next.map((i) => i.id));
    setAnnouncement(t.moved(moved.name, to + 1, next.length));
    if (focusKey) focusAfterMove.current = focusKey;
  }

  // Restore focus after keyed reorders/removals (DOM moves can drop focus).
  useEffect(() => {
    const key = focusAfterMove.current;
    if (!key) return;
    focusAfterMove.current = null;
    if (key === "picker") {
      zoneRef.current?.querySelector<HTMLButtonElement>("[data-browse]")?.focus();
      return;
    }
    const target = listRef.current?.querySelector<HTMLButtonElement>(`[data-focus-key="${CSS.escape(key)}"]`);
    if (target && !target.disabled) {
      target.focus();
      return;
    }
    // e.g. moved to the first position, so "earlier" is now disabled: focus another button of the item.
    const itemId = key.slice(key.indexOf(":") + 1);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-focus-key$=":${CSS.escape(itemId)}"]:not(:disabled)`)?.focus();
  }, [items]);

  // Mirror new files into a named file input for plain form submission.
  useEffect(() => {
    if (!name || !mirrorRef.current) return;
    const dt = new DataTransfer();
    for (const item of items) if (item.file) dt.items.add(item.file);
    mirrorRef.current.files = dt.files;
  }, [items, name]);

  // Revoke object URLs we created when unmounting.
  useEffect(() => {
    const urls = createdUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    if (disabled) return;
    const files = e.clipboardData?.files;
    if (!files || files.length === 0) return;
    if (pasteScope === "zone" && !zoneRef.current?.contains(document.activeElement)) return;
    if (pasteScope === "document" && isEditable(e.target) && !zoneRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    addFiles(files);
  });

  useEffect(() => {
    const handler = (e: ClipboardEvent) => onPaste(e);
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);

  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <div className={cx("grid gap-1.5", className)}>
      <p id={labelId} className={labelClass}>
        {label}
        <RequiredMark required={required} />
      </p>

      {items.length > 0 && (
        <ul ref={listRef} aria-labelledby={labelId} className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((item, index) => {
            const isCover = cover && index === 0;
            return (
              <li
                key={item.id}
                draggable={!disabled}
                onDragStart={(e) => {
                  setDragId(item.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", item.id);
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  if (dragId) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  move(items.findIndex((i) => i.id === dragId), index);
                  setDragId(null);
                }}
                className={cx(
                  "group relative aspect-square overflow-hidden rounded-[4px] border border-line bg-panel-3",
                  isCover && "col-span-2 row-span-2",
                  dragId === item.id && "opacity-40",
                  item.status === "error" && "border-crit",
                )}
              >
                {/* Object URLs and storage URLs: plain img. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.name} className="absolute inset-0 size-full object-cover" draggable={false} />
                {isCover && (
                  <span className="type-label absolute top-1.5 left-1.5 rounded-[3px] bg-accent px-1.5 py-px text-[10px] text-on-accent">
                    {t.cover}
                  </span>
                )}
                <span
                  aria-hidden="true"
                  title={t.dragHandle}
                  className="absolute top-1.5 right-1.5 cursor-grab rounded-[3px] bg-panel/90 px-1 font-mono text-xs leading-tight text-ink active:cursor-grabbing"
                >
                  ⠿
                </span>
                {item.status === "uploading" && (
                  <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-panel/85 py-1 text-center text-[11px] text-ink">
                    {t.uploading}
                  </span>
                )}
                {item.status === "error" && (
                  <span role="alert" className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-crit-soft py-1 text-center text-[11px] text-crit">
                    {item.error ?? t.failed}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-panel/90 p-1">
                  <span className="flex gap-1">
                    <TileButton
                      focusKey={`earlier:${item.id}`}
                      label={t.moveEarlier(item.name)}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, index - 1, `earlier:${item.id}`)}
                    >
                      ←
                    </TileButton>
                    <TileButton
                      focusKey={`later:${item.id}`}
                      label={t.moveLater(item.name)}
                      disabled={disabled || index === items.length - 1}
                      onClick={() => move(index, index + 1, `later:${item.id}`)}
                    >
                      →
                    </TileButton>
                  </span>
                  <TileButton focusKey={`remove:${item.id}`} label={t.remove(item.name)} disabled={disabled} onClick={() => remove(item, index)} danger>
                    ×
                  </TileButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div
        ref={zoneRef}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        onDragEnter={(e) => {
          if (!dragId && isFileDrag(e)) setDragActive(true);
        }}
        onDragOver={(e) => {
          if (!dragId && isFileDrag(e)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={(e) => {
          if (dragId || !isFileDrag(e)) return;
          e.preventDefault();
          setDragActive(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cx(
          "grid place-items-center gap-1.5 rounded-card border-[1.5px] border-dashed px-4 py-6 text-center transition-colors",
          dragActive ? "border-accent bg-accent-soft" : message ? "border-crit" : "border-line-strong bg-panel",
          disabled && "opacity-60",
        )}
      >
        <p className="text-[13px] font-medium text-ink">{dragActive ? t.dragging : t.title}</p>
        <p className="text-xs text-muted">{t.body}</p>
        <button
          type="button"
          data-browse=""
          disabled={disabled}
          onClick={() => pickerRef.current?.click()}
          className="mt-1 rounded-control border border-line bg-panel px-3 py-1.5 text-[13px] text-ink hover:bg-panel-2 disabled:cursor-not-allowed"
        >
          {t.browse}
        </button>
        <input
          ref={pickerRef}
          type="file"
          accept={accept}
          multiple={multiple}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      {message && <FieldErrorText id={errorId!}>{message}</FieldErrorText>}
      {rejections.length > 0 && (
        <ul role="alert" className="grid gap-0.5 text-xs text-crit">
          {rejections.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {name && <input ref={mirrorRef} type="file" name={name} multiple hidden tabIndex={-1} aria-hidden="true" />}
      {orderName && <input type="hidden" name={orderName} value={items.map((i) => i.id).join(",")} />}
    </div>
  );
}

function TileButton({
  children,
  label,
  onClick,
  disabled,
  danger,
  focusKey,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  focusKey: string;
}) {
  return (
    <button
      type="button"
      data-focus-key={focusKey}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "grid size-6 place-items-center rounded-[3px] border border-line bg-panel text-xs text-ink hover:bg-panel-2",
        "disabled:cursor-not-allowed disabled:opacity-35",
        danger && "text-crit hover:bg-crit-soft",
      )}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
