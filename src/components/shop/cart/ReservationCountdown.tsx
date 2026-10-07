"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/shop/ui/cn";
import { cartCopy } from "./_copy";

const t = cartCopy.countdown;

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * "Reserved for you · 12:41". Ticks every second; when the hold runs out it refreshes the route once
 * (so the server can show "No longer reserved — re-add"). Purely informational: the server enforces.
 */
export function ReservationCountdown({
  expiresAt,
  label = t.reservedFor,
  refreshOnExpire = true,
  className,
}: {
  expiresAt: string;
  label?: string;
  refreshOnExpire?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const end = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const refreshed = useRef(false);
  const left = end - now;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (left <= 0 && refreshOnExpire && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [left, refreshOnExpire, router]);

  const expired = left <= 0;
  const urgent = !expired && left < 2 * 60_000;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-shop-sm px-2 py-0.5 text-xs font-medium",
        expired ? "bg-shop-sunken text-shop-muted" : urgent ? "bg-shop-warn-soft text-shop-warn" : "bg-shop-ok-soft text-shop-ok",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="shrink-0">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5V8l2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {expired ? (
        t.expired
      ) : (
        <>
          <span>{label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums" suppressHydrationWarning aria-hidden="true">
            {formatRemaining(left)}
          </span>
          <span className="sr-only" suppressHydrationWarning>{t.srLabel(Math.ceil(left / 60_000))}</span>
        </>
      )}
    </span>
  );
}
