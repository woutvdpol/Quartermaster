import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "primary" | "accent" | "sold" | "reserved" | "ok" | "warn";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-shop-surface text-shop-ink border-transparent shadow-shop",
  primary: "bg-shop-primary text-shop-on-primary border-transparent",
  accent: "bg-shop-accent text-shop-on-accent border-transparent",
  sold: "bg-shop-ink text-shop-bg border-transparent",
  reserved: "bg-shop-warn-soft text-shop-warn border-shop-warn/30",
  ok: "bg-shop-ok-soft text-shop-ok border-shop-ok/25",
  warn: "bg-shop-warn-soft text-shop-warn border-shop-warn/30",
};

/** Small pill label ("Sold", "Reserved", "Sale", tag names). */
export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-shop-control border px-2.5 py-1 text-xs leading-4 font-semibold",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
