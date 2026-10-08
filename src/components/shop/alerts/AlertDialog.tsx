"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";

type Frequency = "INSTANT" | "DAILY" | "WEEKLY";

const loadPanel = () => import("./AlertDialogPanel");
// Code-split: the dialog (form, Turnstile, copy) loads on first use — hover/focus preloads it.
const AlertDialogPanel = dynamic(() => loadPanel().then((m) => m.AlertDialogPanel), { ssr: false });

/**
 * Shared trigger of NotifyMeButton / SaveSearchButton. Renders identical HTML for every visitor
 * (cache-friendly); the dialog itself (AlertDialogPanel.tsx) is loaded and opened on click.
 */
export function AlertDialogButton({
  source,
  label,
  title,
  intro,
  variant = "outline",
  size = "md",
  fullWidth,
  className,
  defaultFrequency = "INSTANT",
}: {
  /** `{ productId }` (suggest from product) or `{ query: CatalogSearchInput }`. */
  source: unknown;
  label: string;
  title: string;
  intro: string;
  variant?: "primary" | "outline" | "accent" | "secondary" | "ghost";
  size?: "sm" | "md";
  fullWidth?: boolean;
  className?: string;
  defaultFrequency?: Frequency;
}) {
  const [openSignal, setOpenSignal] = useState(0);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        className={className}
        onClick={() => setOpenSignal((n) => n + 1)}
        onPointerEnter={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        aria-haspopup="dialog"
      >
        <BellIcon />
        {label}
      </Button>
      {openSignal > 0 ? (
        <AlertDialogPanel key={openSignal} source={source} title={title} intro={intro} defaultFrequency={defaultFrequency} />
      ) : null}
    </>
  );
}

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn("shrink-0", className)}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" strokeLinejoin="round" />
      <path d="M10 20.5a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}
