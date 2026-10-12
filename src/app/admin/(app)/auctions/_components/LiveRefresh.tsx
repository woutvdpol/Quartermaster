"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AUCTION_PATHS } from "@/server/auctions/paths";
import { auctionsCopy as t } from "../_copy";

const MIN_INTERVAL_MS = 1000;
const POLL_MS = 5000;

/**
 * Keeps the auction board live. Listens to the engine's SSE stream (/api/auctions/[id]/stream) and,
 * on every lot event, re-renders the server page (router.refresh → getAuctionAdmin, which has the
 * leader identity the public stream doesn't carry), throttled to once per second. Falls back to
 * polling every 5 s when the stream is unavailable.
 */
export function LiveRefresh({ auctionId }: { auctionId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"stream" | "poll">("stream");

  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const refresh = () => {
      const wait = last + MIN_INTERVAL_MS - Date.now();
      if (wait <= 0) {
        last = Date.now();
        router.refresh();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          router.refresh();
        }, wait);
      }
    };

    const startPolling = () => {
      if (poll) return;
      setMode("poll");
      poll = setInterval(refresh, POLL_MS);
    };

    if (typeof EventSource === "undefined") {
      startPolling();
      return () => {
        if (poll) clearInterval(poll);
      };
    }

    const source = new EventSource(AUCTION_PATHS.stream(auctionId));
    source.addEventListener("lot", refresh);
    // A snapshot after the first one means the stream reconnected or the auction itself changed.
    let snapshots = 0;
    source.addEventListener("snapshot", () => {
      if (snapshots++ > 0) refresh();
    });
    source.onopen = () => {
      failures = 0;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      setMode("stream");
    };
    source.onerror = () => {
      failures += 1;
      // EventSource retries by itself; after a few failures (or a hard close) poll instead.
      if (failures >= 3 || source.readyState === EventSource.CLOSED) startPolling();
    };

    return () => {
      source.close();
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
    };
  }, [auctionId, router]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
      <span aria-hidden className={mode === "stream" ? "size-2 rounded-full bg-ok" : "size-2 rounded-full bg-warn"} />
      {mode === "stream" ? t.live.connected : t.live.polling}
    </span>
  );
}
