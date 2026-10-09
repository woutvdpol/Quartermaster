"use client";

import { useState, useTransition } from "react";
import { Button, StatusPill, cx, toast, type StatusTone } from "@/components/admin/ui";
import { approveTranslationAction, suggestTranslationAction, withdrawTranslationAction, type CellRef } from "../actions";

export type CellStatus = "QUEUED" | "MACHINE" | "APPROVED" | null;

export function statusChip(status: CellStatus, stale: boolean): { tone: StatusTone; label: string } {
  if (status === "APPROVED") return stale ? { tone: "warn", label: "English changed · old translation online" } : { tone: "ok", label: "Reviewed · online" };
  if (status === "MACHINE") return { tone: "warn", label: "Automatic · not online until reviewed" };
  if (status === "QUEUED") return { tone: "mute", label: "Waiting for the translator" };
  return { tone: "mute", label: "Not translated" };
}

/**
 * One translatable text: English original (left) and the editable translation (right) with
 * "Approve & publish", "Translate again" and "Use original". Approving is the only way a text
 * reaches the shop. Design: docs/design/insights-duplicates-i18n/Translate.dc.html.
 */
export function TranslationEditor({
  cell,
  fieldLabel,
  source,
  markdown,
  status: initialStatus,
  value: initialValue,
  stale: initialStale,
  showSource = true,
  onApproved,
}: {
  cell: CellRef;
  fieldLabel: string;
  source: string | null;
  markdown: boolean;
  status: CellStatus;
  value: string | null;
  stale: boolean;
  showSource?: boolean;
  onApproved?: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [status, setStatus] = useState<CellStatus>(initialStatus);
  const [stale, setStale] = useState(initialStale);
  const [savedValue, setSavedValue] = useState(initialValue ?? "");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"approve" | "suggest" | "withdraw" | null>(null);
  const chip = statusChip(status, stale);
  const dirty = value.trim() !== savedValue.trim();
  const long = markdown || (source?.length ?? 0) > 120;
  const id = `tr-${cell.entity}-${cell.entityId}-${cell.field}-${cell.locale}`;

  const run = (kind: "approve" | "suggest" | "withdraw") =>
    start(async () => {
      setBusy(kind);
      try {
        if (kind === "approve") {
          const res = await approveTranslationAction(cell, value);
          if (!res.ok) return void toast.crit(res.message ?? "Could not approve.");
          setStatus("APPROVED");
          setStale(false);
          setSavedValue(value);
          toast.ok(res.message ?? "Approved.");
          onApproved?.();
        } else if (kind === "suggest") {
          const res = await suggestTranslationAction(cell);
          if (!res.ok || !res.data) return void toast.crit(res.message ?? "Could not translate.");
          setValue(res.data.value);
          if (res.data.stored) {
            setStatus("MACHINE");
            setSavedValue(res.data.value);
          }
          (res.data.missing ? toast.warn : toast.ok)(res.message ?? "Translated.");
        } else {
          const res = await withdrawTranslationAction(cell);
          if (!res.ok) return void toast.crit(res.message ?? "Could not take it offline.");
          setStatus("MACHINE");
          toast.ok(res.message ?? "Taken offline.");
        }
      } finally {
        setBusy(null);
      }
    });

  return (
    <div className={cx("grid gap-3", showSource && "md:grid-cols-2")}>
      {showSource ? (
        <div className="grid content-start gap-1">
          <span className="type-label text-[11px] text-muted">{fieldLabel} · English</span>
          <p className="max-h-72 overflow-auto rounded-control border border-line bg-panel-2 px-2.5 py-2 text-[13px] leading-[1.55] whitespace-pre-wrap text-ink">
            {source ?? <span className="text-muted">(empty)</span>}
          </p>
        </div>
      ) : null}
      <div className="grid content-start gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={id} className="type-label text-[11px] text-muted">
            {fieldLabel} · {cell.locale.toUpperCase()}
          </label>
          <StatusPill tone={chip.tone}>{chip.label}</StatusPill>
        </div>
        {long ? (
          <textarea
            id={id}
            rows={markdown ? 8 : 3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={status === "QUEUED" ? "The translator is working on it — or type your own translation." : "Type a translation or use “Translate again”."}
            className="w-full rounded-control border border-line bg-panel px-2.5 py-2 text-[13px] leading-[1.55] text-ink focus:border-accent"
            lang={cell.locale}
          />
        ) : (
          <input
            id={id}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={status === "QUEUED" ? "Waiting for the translator — or type your own." : "Type a translation or use “Translate again”."}
            className="w-full rounded-control border border-line bg-panel px-2.5 py-1.5 text-[13px] text-ink focus:border-accent"
            lang={cell.locale}
          />
        )}
        {markdown ? <p className="text-[11.5px] text-muted">Markdown: keep **bold**, lists and links as they are.</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={pending || !value.trim() || !source} onClick={() => run("approve")}>
            {busy === "approve" ? "Approving…" : status === "APPROVED" && !dirty && !stale ? "Approved" : "Approve & publish"}
          </Button>
          <Button variant="secondary" size="sm" disabled={pending || !source} onClick={() => run("suggest")} title="New machine translation of the current English text">
            {busy === "suggest" ? "Translating…" : "Translate again"}
          </Button>
          <Button variant="ghost" size="sm" disabled={pending || !source} onClick={() => setValue(source ?? "")} title="Keep the English text in this language (names, titles)">
            Use original
          </Button>
          {status === "APPROVED" ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run("withdraw")} className="ml-auto text-muted">
              {busy === "withdraw" ? "…" : "Take offline"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
