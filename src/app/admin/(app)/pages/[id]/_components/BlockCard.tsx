"use client";

import { useState, useTransition } from "react";
import { Button, ConfirmDialog, InlineAlert, Spinner, Switch, cx, toast } from "@/components/admin/ui";
import { catalogEntry } from "@/server/content/blocks";
import { markdownToPlainText } from "@/server/content/markdown";
import { copy } from "../../_copy";
import { BLOCK_FIELDS, checkDraft, issuesByPath, toDraft, type BlockDraft } from "../../_lib/block-fields";
import { removeBlockAction, saveBlockAction } from "../actions";
import { BlockFields } from "./BlockFields";
import type { EditorBlock, EditorContextValue } from "./types";

const t = copy.block;

/** One-line summary of a block's content for the collapsed card. */
function summary(data: BlockDraft): string {
  for (const k of ["title", "quote", "markdown", "text"]) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return k === "markdown" ? markdownToPlainText(v).slice(0, 120) : v.slice(0, 120);
  }
  if (Array.isArray(data.items)) return `${data.items.length} question${data.items.length === 1 ? "" : "s"}`;
  return "";
}

type Props = {
  index: number;
  block: EditorBlock;
  draft: BlockDraft | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: BlockDraft | null) => void;
  onToggleVisible: (visible: boolean) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddBelow: () => void;
  editor: EditorContextValue;
};

export function BlockCard({ index, block, draft, open, onOpenChange, onDraftChange, onToggleVisible, onMoveUp, onMoveDown, onAddBelow, editor }: Props) {
  const entry = catalogEntry(block.type);
  const saved = toDraft(block.type, block.data);
  const current = draft ?? saved;
  const dirty = draft !== undefined;
  const [showErrors, setShowErrors] = useState(!block.valid);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const check = checkDraft(block.type, current);
  const clientErrors = check.ok ? {} : issuesByPath(check.issues);
  const errors = showErrors ? { ...serverErrors, ...clientErrors } : serverErrors;
  const headingId = `block-${block.id}-title`;
  const bodyId = `block-${block.id}-body`;

  function change(key: string, value: unknown) {
    setServerErrors((cur) => {
      if (!Object.keys(cur).some((k) => k === key || k.startsWith(`${key}.`))) return cur;
      return Object.fromEntries(Object.entries(cur).filter(([k]) => k !== key && !k.startsWith(`${key}.`)));
    });
    onDraftChange({ ...current, [key]: value });
  }

  function save() {
    setShowErrors(true);
    setFormError(null);
    if (!check.ok) {
      setFormError(t.fixFields);
      return;
    }
    startSaving(async () => {
      const res = await saveBlockAction(editor.pageId, block.id, check.data);
      if (res.ok) {
        onDraftChange(null);
        setServerErrors({});
        setShowErrors(false);
        toast.ok(res.message ?? t.saved);
      } else {
        setServerErrors((res.fieldErrors ?? {}) as Record<string, string[]>);
        setFormError(res.message ?? "Could not save the block.");
      }
    });
  }

  function discard() {
    onDraftChange(null);
    setServerErrors({});
    setFormError(null);
    setShowErrors(!block.valid);
  }

  const text = summary(current);

  return (
    <article
      aria-labelledby={headingId}
      className={cx(
        "rounded-card border bg-panel shadow-card",
        !block.valid ? "border-warn" : dirty ? "border-accent" : "border-line",
        !block.isVisible && "bg-panel-2",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
        <span className="font-mono text-xs text-muted tabular-nums" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-[13.5px] font-semibold text-ink">
              <span className="sr-only">Block {index + 1}: </span>
              {entry.label}
            </h3>
            <span className="rounded-[3px] border border-line px-1 font-mono text-[10px] text-muted" title="Icon">
              {entry.icon}
            </span>
            {!block.isVisible && <span className="type-label text-[10.5px] text-muted">{copy.editor.hiddenTag}</span>}
            {!block.valid && <span className="type-label text-[10.5px] text-warn">Needs attention</span>}
            {dirty && <span className="type-label text-[10.5px] text-accent">{t.unsaved}</span>}
          </div>
          {text && !open && <p className="truncate text-[12.5px] text-muted">{text}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Switch label={<span className="text-xs">{t.visible}</span>} checked={block.isVisible} onChange={(e) => onToggleVisible(e.target.checked)} />
          <Button size="sm" variant="ghost" aria-label={`${t.moveUp}: ${entry.label}`} title={block.type === "HERO" ? t.heroFirst : t.moveUp} disabled={!onMoveUp} onClick={onMoveUp}>
            ↑
          </Button>
          <Button size="sm" variant="ghost" aria-label={`${t.moveDown}: ${entry.label}`} title={block.type === "HERO" ? t.heroFirst : t.moveDown} disabled={!onMoveDown} onClick={onMoveDown}>
            ↓
          </Button>
          <Button size="sm" aria-expanded={open} aria-controls={bodyId} onClick={() => onOpenChange(!open)}>
            {open ? t.close : t.edit}
          </Button>
          <ConfirmDialog
            trigger={t.remove}
            triggerSize="sm"
            title={t.removeTitle(entry.label)}
            description={t.removeBody}
            confirmLabel={t.remove}
            action={removeBlockAction}
            fields={{ pageId: editor.pageId, blockId: block.id }}
          />
        </div>
      </header>

      {!block.valid && (
        <div className="px-3.5 pb-3">
          <InlineAlert tone="warn" title={t.invalidTitle}>
            <p>{t.invalidBody}</p>
            <ul className="mt-1 list-disc pl-5">
              {block.issues.map((i, n) => (
                <li key={n}>
                  {i.path && <span className="font-mono text-xs">{i.path}: </span>}
                  {i.message}
                </li>
              ))}
            </ul>
          </InlineAlert>
        </div>
      )}

      <div id={bodyId} hidden={!open} className="border-t border-line px-3.5 py-3.5">
        {open && (
          <div className="grid gap-4">
            <BlockFields blockId={block.id} specs={BLOCK_FIELDS[block.type]} draft={current} onChange={change} errors={errors} editor={editor} />
            {formError && (
              <InlineAlert tone="crit" live="alert">
                {formError}
              </InlineAlert>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <Button size="sm" variant="ghost" onClick={onAddBelow} aria-haspopup="dialog" disabled={false}>
                + {copy.editor.addBelow}
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!dirty || saving} onClick={discard}>
                  {t.discard}
                </Button>
                <Button variant="primary" disabled={(!dirty && block.valid) || saving} aria-busy={saving || undefined} onClick={save}>
                  {saving && <Spinner />}
                  {saving ? t.saving : t.save}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
