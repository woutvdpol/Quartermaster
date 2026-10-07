"use client";

import { useEffect, useState, type ReactNode } from "react";
import { StatusPill } from "@/components/admin/ui";

function format(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * "In cart · mm:ss" pill counting down to the reservation's expiry. After expiry it shows
 * `fallback` (the product's own status pill). The visible timer is not announced every second;
 * the accessible label carries the expiry time instead.
 */
export function ReservationCountdown({
  until,
  label,
  expiresLabel,
  fallback,
}: {
  /** ISO timestamp of the reservation expiry. */
  until: string;
  label: string;
  /** Expiry time formatted on the server in the shop's timezone, e.g. "14:32". */
  expiresLabel: string;
  fallback: ReactNode;
}) {
  const end = Date.parse(until);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  // Server render and hydration show a neutral placeholder; the clock starts after mount.
  const remaining = now === null ? null : end - now;
  if (remaining !== null && remaining <= 0) return <>{fallback}</>;

  return (
    <span title={`${label} until ${expiresLabel}`}>
      <StatusPill tone="warn">
        {label}
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums" aria-hidden="true" suppressHydrationWarning>
          {remaining === null ? "--:--" : format(remaining)}
        </span>
        <span className="sr-only">until {expiresLabel}</span>
      </StatusPill>
    </span>
  );
}
