"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EMPTY_TRACKER, addOffsetSample, offsetSample, type OffsetTracker } from "./lib/clock";
import { POLL_AFTER_FAILURES, POLL_INTERVAL_MS, backoffDelay } from "./lib/backoff";
import type { LiveLot } from "./lib/types";

/*
 * Live auction state for one page (docs/auctions-plan.md § Live verversen). Exactly one connection per
 * page: the provider opens an EventSource to /api/auctions/<id>/stream and every lot card, countdown
 * and bid box below it reads from here.
 *
 *  - Stream events: `snapshot` {lots, serverTime} on connect, then `lot` {lot, serverTime} per change
 *    and heartbeats. Every serverTime feeds the clock offset (countdowns never trust the device clock).
 *  - Stream down: reconnect with exponential backoff; in between, poll /api/auctions/<id>/lots every 5 s.
 *  - Tab hidden: everything stops (no stream, no polling); visible again → reconnect at once.
 *  - A lot whose closesAt moves forward (late-bid extension) is flagged for a few seconds ("extended" flash).
 */

export type LiveStatus = "connecting" | "live" | "polling" | "paused";

type LiveValue = {
  lots: Record<string, LiveLot>;
  /** serverTime − deviceTime in ms. */
  offset: number;
  status: LiveStatus;
  /** Lot id → device ms until which the "time extended" flash shows. */
  flashes: Record<string, number>;
  /** Applies a lot state the page got from a server action (e.g. right after placing a bid). */
  apply: (lot: LiveLot) => void;
};

const LiveContext = createContext<LiveValue | null>(null);
/** Server-clock offset alone: provided by AuctionLiveProvider and by <ServerClock> on pages without a stream. */
const ClockContext = createContext(0);

const FLASH_MS = 6_000;

type SnapshotMsg = { lots?: LiveLot[]; serverTime?: string };
type LotMsg = { lot?: LiveLot; serverTime?: string };

function parse<T>(data: unknown): T | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function byId(lots: readonly LiveLot[]): Record<string, LiveLot> {
  return Object.fromEntries(lots.map((l) => [l.id, l]));
}

/** Lots whose closing time moved forward between two states (late-bid extension). */
function extendedIds(prev: Record<string, LiveLot>, next: readonly LiveLot[]): string[] {
  return next.filter((l) => l.status === "OPEN" && prev[l.id] && Date.parse(l.closesAt) > Date.parse(prev[l.id].closesAt)).map((l) => l.id);
}

export function AuctionLiveProvider({
  auctionId,
  initialLots,
  serverTime,
  children,
}: {
  auctionId: string;
  initialLots: LiveLot[];
  /** Server time when the page was rendered (first clock sample until the stream speaks). */
  serverTime: string;
  children: ReactNode;
}) {
  const [lots, setLots] = useState<Record<string, LiveLot>>(() => byId(initialLots));
  const [tracker, setTracker] = useState<OffsetTracker>(EMPTY_TRACKER);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const lotsRef = useRef(lots);
  const applyRef = useRef<(lot: LiveLot) => void>(() => {});
  useEffect(() => {
    lotsRef.current = lots;
  }, [lots]);

  // The render-time sample is rough (HTML transfer + hydration delay make it too small); stream and
  // poll samples replace it as soon as they are larger, see lib/clock.ts.
  const initialSample = useRef(serverTime);
  useEffect(() => {
    setTracker((t) => addOffsetSample(t, offsetSample(initialSample.current, Date.now())));
  }, []);

  useEffect(() => {
    const streamUrl = `/api/auctions/${encodeURIComponent(auctionId)}/stream`;
    const pollUrl = `/api/auctions/${encodeURIComponent(auctionId)}/lots`;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let disposed = false;
    let pollAbort: AbortController | null = null;

    const clock = (serverTime: string | undefined, receivedAt: number, sentAt?: number) => {
      if (serverTime) setTracker((t) => addOffsetSample(t, offsetSample(serverTime, receivedAt, sentAt)));
    };

    const flash = (ids: string[]) => {
      if (!ids.length) return;
      const until = Date.now() + FLASH_MS;
      setFlashes((f) => ({ ...f, ...Object.fromEntries(ids.map((id) => [id, until])) }));
    };

    const applyAll = (list: LiveLot[]) => {
      const prev = lotsRef.current;
      flash(extendedIds(prev, list));
      // Snapshots leave cancelled (withdrawn) lots out: keep them, marked withdrawn.
      const next = byId(list);
      for (const id of Object.keys(prev)) if (!next[id]) next[id] = { ...prev[id], status: "CANCELLED" };
      lotsRef.current = next;
      setLots(next);
    };

    const applyOne = (lot: LiveLot) => {
      flash(extendedIds(lotsRef.current, [lot]));
      lotsRef.current = { ...lotsRef.current, [lot.id]: lot };
      setLots((prev) => ({ ...prev, [lot.id]: lot }));
    };

    applyRef.current = applyOne;

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      pollAbort?.abort();
      pollAbort = null;
    };

    const pollOnce = async () => {
      pollAbort?.abort();
      const ctrl = new AbortController();
      pollAbort = ctrl;
      const sentAt = Date.now();
      try {
        const res = await fetch(pollUrl, { cache: "no-store", signal: ctrl.signal, headers: { accept: "application/json" } });
        if (!res.ok) return;
        const body = (await res.json()) as SnapshotMsg;
        if (ctrl.signal.aborted) return;
        clock(body.serverTime, Date.now(), sentAt);
        if (Array.isArray(body.lots)) applyAll(body.lots);
      } catch {
        // offline / aborted: the next tick tries again
      }
    };

    const startPolling = () => {
      if (pollTimer || disposed) return;
      setStatus("polling");
      void pollOnce();
      pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
    };

    const closeStream = () => {
      es?.close();
      es = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connect = () => {
      if (disposed || document.visibilityState === "hidden") return;
      closeStream();
      if (!pollTimer) setStatus("connecting");
      const source = new EventSource(streamUrl);
      es = source;
      const healthy = () => {
        failures = 0;
        stopPolling();
        setStatus("live");
      };
      source.addEventListener("open", healthy);
      source.addEventListener("snapshot", (e) => {
        const msg = parse<SnapshotMsg>((e as MessageEvent).data);
        if (!msg) return;
        clock(msg.serverTime, Date.now());
        if (Array.isArray(msg.lots)) applyAll(msg.lots);
        healthy();
      });
      source.addEventListener("lot", (e) => {
        const msg = parse<LotMsg>((e as MessageEvent).data);
        if (!msg) return;
        clock(msg.serverTime, Date.now());
        if (msg.lot) applyOne(msg.lot);
      });
      const beat = (e: Event) => {
        const msg = parse<{ serverTime?: string }>((e as MessageEvent).data);
        clock(msg?.serverTime, Date.now());
      };
      source.addEventListener("heartbeat", beat);
      source.addEventListener("ping", beat);
      source.addEventListener("error", () => {
        if (es !== source) return;
        // Take over reconnecting ourselves (EventSource's own retry has no backoff or polling).
        closeStream();
        failures += 1;
        if (failures >= POLL_AFTER_FAILURES) startPolling();
        else setStatus("connecting");
        retryTimer = setTimeout(connect, backoffDelay(failures - 1));
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        closeStream();
        stopPolling();
        setStatus("paused");
      } else {
        failures = 0;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      closeStream();
      stopPolling();
    };
  }, [auctionId]);

  // Drop expired flashes.
  useEffect(() => {
    const ids = Object.keys(flashes);
    if (!ids.length) return;
    const next = Math.min(...Object.values(flashes)) - Date.now();
    const t = setTimeout(() => setFlashes((f) => Object.fromEntries(Object.entries(f).filter(([, until]) => until > Date.now()))), Math.max(0, next) + 50);
    return () => clearTimeout(t);
  }, [flashes]);

  const value = useMemo<LiveValue>(() => ({ lots, offset: tracker.offset, status, flashes, apply: (lot: LiveLot) => applyRef.current(lot) }), [lots, tracker.offset, status, flashes]);
  return (
    <LiveContext.Provider value={value}>
      <ClockContext.Provider value={tracker.offset}>{children}</ClockContext.Provider>
    </LiveContext.Provider>
  );
}

/** Clock offset for countdowns on pages without a stream (auction overview, product banner): one render-time sample. */
export function ServerClock({ serverTime, children }: { serverTime: string; children: ReactNode }) {
  const [offset, setOffset] = useState(0);
  const sample = useRef(serverTime);
  useEffect(() => {
    setOffset(offsetSample(sample.current, Date.now()) ?? 0);
  }, []);
  return <ClockContext.Provider value={offset}>{children}</ClockContext.Provider>;
}

function useLive(): LiveValue {
  const v = useContext(LiveContext);
  if (!v) throw new Error("AuctionLiveProvider missing");
  return v;
}

/** One lot, live (falls back to the given server-rendered lot outside a provider or before the first update). */
export function useLiveLot(fallback: LiveLot): LiveLot {
  const v = useContext(LiveContext);
  return v?.lots[fallback.id] ?? fallback;
}

/** Every lot of the page's auction, live. */
export function useLiveLots(): Record<string, LiveLot> {
  return useLive().lots;
}

/** Pushes a server-returned lot state into the page's live state (no-op outside a provider). */
export function useApplyLot(): (lot: LiveLot) => void {
  return useContext(LiveContext)?.apply ?? noop;
}
const noop = () => {};

export function useLiveStatus(): LiveStatus {
  return useContext(LiveContext)?.status ?? "live";
}

/** True while the lot's "time extended" flash should show. */
export function useExtendedFlash(lotId: string): boolean {
  // Expired entries are dropped by the provider.
  return useContext(LiveContext)?.flashes[lotId] !== undefined;
}

/**
 * Server-clock "now", re-rendering every `everyMs` (default 1 s). Use in leaf components only
 * (countdowns), so a page does not re-render wholesale every second. Before hydration this
 * returns the render-time value (`initial`) so server and client markup match.
 */
export function useServerNow(initial: number, everyMs = 1_000): number {
  const offset = useContext(ClockContext);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now === null ? initial : now + offset;
}
