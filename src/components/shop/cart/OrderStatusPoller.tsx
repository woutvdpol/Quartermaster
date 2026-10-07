"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cartCopy } from "./_copy";

/**
 * While the order waits for Mollie's webhook, re-reads the page from the server every few seconds
 * (router.refresh → the server component reads the DB). It never triggers any state change itself.
 * Backs off (3 s → 15 s) and stops after 15 minutes.
 */
export function OrderStatusPoller({ active }: { active: boolean }) {
  const router = useRouter();
  const [ticking, setTicking] = useState(false);

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let timer: number | undefined;
    let n = 0;
    const tick = () => {
      if (Date.now() - started > 15 * 60_000) return;
      setTicking(true);
      router.refresh();
      window.setTimeout(() => setTicking(false), 800);
      n += 1;
      timer = window.setTimeout(tick, Math.min(15_000, 3000 + n * 1000));
    };
    timer = window.setTimeout(tick, 3000);
    return () => window.clearTimeout(timer);
  }, [active, router]);

  if (!active) return null;
  return (
    <p aria-live="polite" className="text-xs text-shop-muted">
      {ticking ? cartCopy.order.refreshing : " "}
    </p>
  );
}
