import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";

export type StatusTone = "ok" | "warn" | "crit" | "info" | "mute";

const tones: Record<StatusTone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  info: "bg-info-soft text-info",
  mute: "border border-line bg-panel-2 text-muted",
};

/** Status label with a coloured dot; the text carries the meaning, colour only reinforces it. */
export function StatusPill({ tone = "mute", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[11.5px] font-medium whitespace-nowrap ${tones[tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** Striped "WIP" marker for features that are visible but still in progress. */
export function WipBadge({ onRail = false }: { onRail?: boolean }) {
  const t = getDictionary().nav;
  return (
    <span
      title={t.wipTitle}
      className={
        "inline-flex items-center rounded-[3px] border border-dashed px-1.5 py-px font-mono text-[10px] leading-tight font-semibold tracking-[0.12em] " +
        (onRail
          ? "border-rail-muted text-rail-muted"
          : "border-warn text-warn [background:repeating-linear-gradient(135deg,var(--qm-warn-soft)_0_5px,var(--qm-panel)_5px_10px)]")
      }
    >
      {t.wip}
    </span>
  );
}
