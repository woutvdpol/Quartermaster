"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/shop/ui/Button";
import { confirmAge } from "./age-action";
import { layoutCopy } from "./_copy";

const t = layoutCopy.ageGate;

/**
 * Modal age confirmation (legal.ageVerification = "popup"). Rendered by the layout only when the
 * server found no valid confirmation cookie. Cannot be dismissed with Esc; "No" shows a refusal.
 */
export function AgeGate({ shopName, minimumAge }: { shopName: string; minimumAge: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [denied, setDenied] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  if (done) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby="age-gate-title"
      aria-describedby="age-gate-body"
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-shop border border-shop-line bg-shop-surface p-0 text-shop-ink shadow-shop-pop backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-6 sm:p-9">
        <p className="text-sm font-semibold text-shop-primary">{shopName}</p>
        <h2 id="age-gate-title" className="mt-2 text-2xl tracking-[-0.02em] sm:text-[2rem]">
          {t.title(minimumAge)}
        </h2>
        {denied ? (
          <p id="age-gate-body" role="alert" className="mt-4 text-shop-ink-2">
            {t.denied(minimumAge)}
          </p>
        ) : (
          <>
            <p id="age-gate-body" className="mt-4 text-shop-ink-2">
              {t.body(shopName, minimumAge)}
            </p>
            <div className="mt-7 flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                variant="primary"
                pending={pending}
                autoFocus
                onClick={() =>
                  start(async () => {
                    const res = await confirmAge();
                    if (res.ok) {
                      ref.current?.close();
                      setDone(true);
                    }
                  })
                }
              >
                {t.confirm(minimumAge)}
              </Button>
              <Button variant="outline" onClick={() => setDenied(true)}>
                {t.leave}
              </Button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
