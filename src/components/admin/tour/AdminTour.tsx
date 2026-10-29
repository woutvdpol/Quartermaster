"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, buttonClasses } from "@/components/admin/Button";
import { availableSteps, tourSelector, tourSteps, type TourStep } from "./steps";

/*
 * First-sign-in admin tour (docs/admin-tour.md): a spotlight on the dashboard and the sidebar, step by
 * step. Starts by itself for an owner who has not seen it (`autoStart`), or with `?tour=1` (Account and
 * the ⌘K palette link there). Only on the dashboard, so the setup wizard is never interrupted.
 * It counts as seen as soon as it opens; a reload mid-tour does not start it again.
 */

const DASHBOARD = "/admin/dashboard";
const GAP = 12;

type Box = { top: number; left: number; width: number; height: number };

function visibleBox(el: Element | null): Box | null {
  if (!el || el.getClientRects().length === 0) return null; // hidden (e.g. the closed mobile menu)
  const r = el.getBoundingClientRect();
  return r.width && r.height ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
}

export function AdminTour({ shopName, autoStart, markSeen }: { shopName: string; autoStart: boolean; markSeen: () => Promise<void> }) {
  const pathname = usePathname();
  const router = useRouter();
  const forced = useSearchParams().get("tour") === "1";
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const started = useRef(false);

  // Start once per page view on the dashboard.
  useEffect(() => {
    if (started.current || pathname !== DASHBOARD || !(autoStart || forced)) return;
    started.current = true;
    const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
    setSteps(availableSteps(tourSteps(shopName, shortcut), (t) => document.querySelector(tourSelector(t)) !== null));
    setIndex(0);
    if (autoStart) void markSeen();
  }, [pathname, autoStart, forced, shopName, markSeen]);

  const step = steps?.[index] ?? null;
  const count = steps?.length ?? 0;
  const last = index === count - 1;

  const close = useCallback(() => {
    setSteps(null);
    if (forced) router.replace(DASHBOARD, { scroll: false });
  }, [forced, router]);
  const next = useCallback(() => (index === count - 1 ? close() : setIndex((i) => i + 1)), [index, count, close]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Measure the target and place the card next to it (right, else below, else above), inside the viewport.
  const place = useCallback(() => {
    if (!step) return;
    const b = visibleBox(step.target ? document.querySelector(tourSelector(step.target)) : null);
    setBox(b);
    const w = cardRef.current?.offsetWidth ?? 320;
    const h = cardRef.current?.offsetHeight ?? 180;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!b) {
      setPos({ top: Math.max(GAP, (vh - h) / 2), left: Math.max(GAP, (vw - w) / 2) });
      return;
    }
    let left = b.left + b.width + GAP;
    let top = b.top;
    if (left + w > vw - GAP) {
      left = b.left;
      top = b.top + b.height + GAP;
      if (top + h > vh - GAP) top = b.top - h - GAP;
    }
    setPos({ top: Math.min(Math.max(GAP, top), vh - h - GAP), left: Math.min(Math.max(GAP, left), vw - w - GAP) });
  }, [step]);

  useLayoutEffect(() => {
    if (!step) return;
    const el = step.target ? document.querySelector(tourSelector(step.target)) : null;
    if (visibleBox(el)) el!.scrollIntoView({ block: "nearest", inline: "nearest" });
    const frame = requestAnimationFrame(place); // measure after the scroll has been applied
    return () => cancelAnimationFrame(frame);
  }, [step, place]);

  // Focus the card's main button once per step, when it is placed (a hidden card cannot take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (step && placed) primaryRef.current?.focus();
  }, [step, placed]);

  useEffect(() => {
    if (!step) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true); // the sidebar scrolls on its own
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [step, place]);

  // Keys on the window: right after a navigation the focus may still be on the page.
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "Tab") {
        // Keep focus in the card while the rest of the page is covered.
        const items = cardRef.current?.querySelectorAll<HTMLElement>("a[href], button");
        if (!items?.length) return;
        const first = items[0];
        const end = items[items.length - 1];
        const inside = cardRef.current?.contains(document.activeElement);
        if (!inside || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === end)) {
          e.preventDefault();
          (!inside ? first : e.shiftKey ? end : first).focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, close, next, back]);

  if (!steps || !step || pathname !== DASHBOARD) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-control outline-2 outline-offset-2 outline-accent motion-safe:transition-all motion-safe:duration-200"
          style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.5)" }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-black/50" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qm-tour-title"
        aria-describedby="qm-tour-body"
        className="fixed grid w-[min(320px,calc(100vw-24px))] gap-2 rounded-card border border-line bg-panel p-4 text-ink shadow-pop"
        style={pos ?? { visibility: "hidden" }}
      >
        <p className="font-mono text-[11px] text-muted" aria-live="polite">
          {index + 1} / {count}
        </p>
        <h2 id="qm-tour-title" className="text-[15px] font-semibold">
          {step.title}
        </h2>
        <p id="qm-tour-body" className="text-[13.5px] text-ink-2">
          {step.body}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          {last ? (
            <a href="/" target="_blank" rel="noopener" className="text-[13px] font-medium text-accent underline-offset-2 hover:underline">
              View your shop ↗
            </a>
          ) : (
            <button type="button" onClick={close} className="text-[13px] text-muted hover:text-ink">
              Skip tour
            </button>
          )}
          <div className="flex gap-2">
            {index > 0 ? (
              <Button size="sm" onClick={back}>
                Back
              </Button>
            ) : null}
            <button ref={primaryRef} type="button" onClick={next} className={buttonClasses({ variant: "primary", size: "sm" })}>
              {index === 0 ? "Start tour" : last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    // Inside the admin theme root: the colour tokens and fonts are defined there, not on <body>.
    document.querySelector("[data-admin-theme]") ?? document.body,
  );
}
