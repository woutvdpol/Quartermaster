import { connection } from "next/server";
import { getRequestTenant } from "@/server/tenant";
import { getPublicAuctionById } from "@/server/auctions";
import { hasModule } from "@/server/modules";
import { ServiceError } from "@/server/context";
import { freshPublicLot } from "@/server/auctions/live";
import { subscribeAuction, type AuctionEvent } from "@/server/auctions/realtime";

/*
 * Live auction updates as Server-Sent Events: GET /api/auctions/<id>/stream (docs/auctions.md § Live).
 *
 *   event: snapshot  data: { lots: PublicLot[], serverTime }   on connect (and after a listener reconnect)
 *   event: lot       data: { lot: PublicLot, serverTime }      per committed change (bid, extension, close)
 *   event: heartbeat data: { serverTime }                      every 15 s (keeps proxies from timing out)
 *
 * Changes arrive through Postgres LISTEN on `auction_<id>` (one shared connection per process,
 * src/server/auctions/realtime.ts). Only auctions of this host's shop (PUBLISHED / LIVE / CLOSED).
 * Streams end after 25 minutes; EventSource reconnects by itself (spreads load over replicas).
 * ingress-nginx must not buffer: `proxy-buffering: "off"` (deploy/k8s/base/ingress.yaml) + X-Accel-Buffering.
 */

const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = 25 * 60_000;
const FLUSH_MS = 100;

const notFound = () => Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const tenant = await getRequestTenant();
  // 404 without the auctions module (docs/modules.md); getPublicAuctionById would throw UNAVAILABLE.
  if (!tenant || !(await hasModule(tenant.id, "auctions"))) return notFound();
  const { id } = await ctx.params;
  const auction = await getPublicAuctionById(tenant.id, id);
  if (!auction) return notFound();
  const tenantId = tenant.id;
  const auctionId = auction.id;

  const encoder = new TextEncoder();
  let stop: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const timers: NodeJS.Timeout[] = [];
      let unsubscribe: (() => Promise<void>) | null = null;
      const pending = new Set<string>();
      let resync = false;
      let flushTimer: NodeJS.Timeout | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          close();
        }
      };
      const serverTime = () => new Date().toISOString();

      const flush = async () => {
        flushTimer = null;
        if (closed) return;
        try {
          if (resync) {
            resync = false;
            pending.clear();
            const fresh = await getPublicAuctionById(tenantId, auctionId);
            if (!fresh) return close();
            send("snapshot", { lots: fresh.lots, serverTime: fresh.serverTime });
            return;
          }
          const ids = [...pending];
          pending.clear();
          for (const lotId of ids) {
            const lot = await freshPublicLot(tenantId, lotId);
            if (lot && lot.auctionId === auctionId) send("lot", { lot, serverTime: serverTime() });
          }
        } catch (err) {
          // The shop lost the auctions module while the stream was open: end it (EventSource then gets 404s).
          if (err instanceof ServiceError && err.code === "UNAVAILABLE") return close();
          console.warn("[auctions:sse] update failed", err instanceof Error ? err.message : err);
        }
      };
      const schedule = () => {
        flushTimer ??= setTimeout(() => void flush(), FLUSH_MS);
      };
      const onEvent = (ev: AuctionEvent) => {
        if (ev.resync || ev.auction) resync = true;
        else if (ev.lotId) pending.add(ev.lotId);
        else return;
        schedule();
      };

      function close() {
        if (closed) return;
        closed = true;
        for (const t of timers) clearInterval(t);
        if (flushTimer) clearTimeout(flushTimer);
        void unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
      stop = close;

      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      send("snapshot", { lots: auction.lots, serverTime: auction.serverTime });
      unsubscribe = await subscribeAuction(auctionId, onEvent);
      if (closed) {
        await unsubscribe();
        return;
      }
      // A change committed between the snapshot query and LISTEN would be missed: resync once.
      resync = true;
      schedule();
      timers.push(setInterval(() => send("heartbeat", { serverTime: serverTime() }), HEARTBEAT_MS));
      timers.push(setTimeout(close, MAX_STREAM_MS));
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      stop?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
