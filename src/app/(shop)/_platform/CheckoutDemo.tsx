"use client";

import { useEffect, useState } from "react";
import { cn } from "@/components/shop/ui/cn";
import type { platformCopy } from "./_copy";
import { buttonClass, Chip, DEMO_PHOTOS, DemoPhoto, DemoTag, type ChipTone } from "./parts";
import { GlobeIcon, StoreIcon, TableIcon } from "./icons";

/*
 * "Simulate a checkout" on the landing: one stock line, three places the piece shows up, and its three
 * states. Reserved runs a hold clock (15 minutes, the default checkout.reservationMinutes) at demo
 * speed; when it runs out the hold is released, as in the shop.
 */

type CheckoutCopy = (typeof platformCopy)["checkout"];
type PieceCopy = Pick<(typeof platformCopy)["demo"], "piece" | "tagShort">;
type State = keyof CheckoutCopy["states"];
const NEXT: Record<State, State> = { available: "reserved", reserved: "sold", sold: "available" };
const TONE: Record<State, Record<"shop" | "network" | "fair", ChipTone>> = {
  available: { shop: "ok", network: "ok", fair: "info" },
  reserved: { shop: "warn", network: "mute", fair: "warn" },
  sold: { shop: "crit", network: "mute", fair: "crit" },
};
const STEP_TONE: Record<State, ChipTone> = { available: "ok", reserved: "warn", sold: "crit" };
const ROW_BG: Record<State, string> = { available: "bg-pf-paper-2", reserved: "bg-pf-warn-row", sold: "bg-pf-crit-row" };
const CHANNELS = [
  { key: "shop", Icon: StoreIcon },
  { key: "network", Icon: GlobeIcon },
  { key: "fair", Icon: TableIcon },
] as const;

const HOLD_SECONDS = 15 * 60;
// Demo speed: 7 seconds of hold per 120 ms, so the clock visibly runs and ends in about 15 seconds.
const TICK_MS = 120;
const TICK_SECONDS = 7;

function clock(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Only the demo's own texts come in as props, so the rest of the page copy stays out of the client bundle. */
export function CheckoutDemo({ t, d }: { t: CheckoutCopy; d: PieceCopy }) {
  const [state, setState] = useState<State>("available");
  const [left, setLeft] = useState(HOLD_SECONDS);
  const [note, setNote] = useState<string | null>(null);
  // Bumped on every state change: remounts the chips so they replay their settle animation.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (state !== "reserved") return;
    let remaining = HOLD_SECONDS;
    const id = setInterval(() => {
      remaining -= TICK_SECONDS;
      if (remaining > 0) return setLeft(remaining);
      clearInterval(id);
      setState("available");
      setNote(t.expired);
      setVersion((v) => v + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state, t.expired]);

  function advance() {
    setLeft(HOLD_SECONDS);
    setNote(null);
    setState((s) => NEXT[s]);
    setVersion((v) => v + 1);
  }

  const s = t.states[state];
  const live = version > 0;
  return (
    <div className="mt-14 grid items-center gap-[clamp(32px,6vw,80px)] lg:grid-cols-[1.05fr_1fr]">
      <div className="rounded-xl border border-pf-line bg-pf-paper-2 p-4 text-sm leading-[1.45] text-pf-ink shadow-pf-frame sm:p-[22px]">
        <div className="grid grid-cols-[76px_1fr_auto] items-center gap-3.5">
          <DemoPhoto src={DEMO_PHOTOS.greatcoat} />
          <div>
            <span className="font-pf-mono text-[12.5px] leading-none font-medium text-pf-muted">{d.piece.stock}</span>
            <b className="block text-base font-semibold">
              {d.piece.titleStart}
              <span className="whitespace-nowrap">{d.piece.titleEnd}</span>
            </b>
            <span className="text-pf-muted tabular-nums">{d.piece.price}</span>
          </div>
          <DemoTag>{d.tagShort}</DemoTag>
        </div>
        <div aria-live="polite" className="mt-[18px] divide-y divide-pf-line-soft overflow-hidden rounded-lg border border-pf-line">
          {CHANNELS.map(({ key, Icon }) => {
            const [chip, sub] = s[key];
            return (
              <div key={key} className={cn("grid grid-cols-[22px_1fr_auto] items-center gap-3 p-3.5 transition-colors duration-[450ms] ease-pf-out", ROW_BG[state])}>
                <Icon className="size-5 text-pf-muted" />
                <div>
                  <b className="font-semibold">{t.channels[key]}</b>
                  <small className="block text-[13px] text-pf-muted">{sub}</small>
                </div>
                <Chip key={version} tone={TONE[state][key]} className={cn(live && "animate-[pf-flip_0.5s_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none")}>
                  {chip}
                </Chip>
              </div>
            );
          })}
        </div>
        <div className="mt-[18px] flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-h-[1.45em] text-[13px] text-pf-muted">
            {state === "reserved" ? <span className="font-pf-mono">{t.held.replace("{clock}", clock(left))}</span> : (note ?? s.log)}
          </span>
          <button type="button" onClick={advance} className={buttonClass.primarySm}>
            {s.action}
          </button>
        </div>
      </div>
      <div className="grid gap-7">
        {(["available", "reserved", "sold"] as const).map((key) => {
          const step = t.states[key];
          const active = !live || key === state;
          return (
            <div key={key} className="grid grid-cols-[6rem_1fr] items-start gap-3 sm:gap-4">
              <Chip tone={STEP_TONE[key]} className={cn("mt-[3px] justify-self-start transition-[filter] duration-[400ms]", !active && "grayscale")}>
                {step.chip}
              </Chip>
              <div>
                <h3 className={cn("font-pf-display text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] transition-colors duration-[400ms]", !active && "text-pf-muted")}>{step.title}</h3>
                <p className={cn("mt-1.5 transition-colors duration-[400ms]", active ? "text-pf-ink-2" : "text-pf-muted")}>{step.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
