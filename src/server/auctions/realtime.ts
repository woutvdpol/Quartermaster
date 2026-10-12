import "server-only";
import { Client } from "pg";
import { auctionChannel } from "./shared";

/*
 * Postgres LISTEN for the live auction pages (docs/auctions.md § Live). ONE dedicated connection per
 * process (not from the Prisma pool), multiplexing every `auction_<id>` channel the open SSE streams of
 * this process need. Bids/closes NOTIFY inside their transaction, so a message means "committed".
 *
 *  - subscribe(auctionId, fn) → unsubscribe. First subscriber of a channel LISTENs, the last one UNLISTENs.
 *  - Connection lost → reconnect with backoff (1 s … 30 s), re-LISTEN all channels and send every
 *    subscriber a { resync: true } (notifications during the gap are lost; the stream re-sends a snapshot).
 *  - Uses DATABASE_LISTEN_URL when set (must be a session-level connection: LISTEN does not work through a
 *    PgBouncer in transaction mode), else DATABASE_URL.
 */

export type AuctionEvent = { lotId?: string; auction?: string; resync?: true };
type Subscriber = (event: AuctionEvent) => void;

class AuctionListener {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private readonly channels = new Map<string, Set<Subscriber>>();
  private retryMs = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private connectionString(): string {
    const url = process.env.DATABASE_LISTEN_URL || process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    return url;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      const client = new Client({ connectionString: this.connectionString(), application_name: "quartermaster-auction-listen", keepAlive: true });
      client.on("notification", (msg) => this.dispatch(msg.channel, msg.payload));
      const lost = (err?: Error) => {
        if (this.client !== client) return;
        if (err) console.warn("[auctions:listen] connection lost", err.message);
        this.client = null;
        client.removeAllListeners("notification");
        void client.end().catch(() => {});
        this.scheduleReconnect();
      };
      client.on("error", lost);
      client.on("end", () => lost());
      await client.connect();
      for (const channel of this.channels.keys()) await client.query(`LISTEN "${channel}"`);
      this.client = client;
      this.retryMs = 1000;
      return client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.channels.size === 0) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect()
        .then(() => {
          for (const subs of this.channels.values()) for (const fn of subs) safeCall(fn, { resync: true });
        })
        .catch((err) => {
          console.warn("[auctions:listen] reconnect failed", err instanceof Error ? err.message : err);
          this.scheduleReconnect();
        });
    }, wait);
    this.reconnectTimer.unref?.();
  }

  private dispatch(channel: string, payload: string | undefined) {
    const subs = this.channels.get(channel);
    if (!subs?.size) return;
    let event: AuctionEvent = {};
    try {
      event = payload ? (JSON.parse(payload) as AuctionEvent) : {};
    } catch {
      event = {};
    }
    for (const fn of subs) safeCall(fn, event);
  }

  async subscribe(auctionId: string, fn: Subscriber): Promise<() => Promise<void>> {
    const channel = auctionChannel(auctionId);
    let subs = this.channels.get(channel);
    const fresh = !subs;
    if (!subs) this.channels.set(channel, (subs = new Set()));
    subs.add(fn);
    try {
      const client = await this.connect();
      if (fresh) await client.query(`LISTEN "${channel}"`);
    } catch (err) {
      // Stay subscribed: the reconnect loop LISTENs once the database is back (the client polls meanwhile).
      console.warn("[auctions:listen] subscribe failed", err instanceof Error ? err.message : err);
      this.scheduleReconnect();
    }
    let done = false;
    return async () => {
      if (done) return;
      done = true;
      const set = this.channels.get(channel);
      if (!set) return;
      set.delete(fn);
      if (set.size === 0) {
        this.channels.delete(channel);
        if (this.client) await this.client.query(`UNLISTEN "${channel}"`).catch(() => {});
      }
    };
  }

  /** For health checks / tests. */
  stats() {
    return { connected: !!this.client, channels: this.channels.size, subscribers: [...this.channels.values()].reduce((n, s) => n + s.size, 0) };
  }

  async close() {
    this.channels.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const c = this.client;
    this.client = null;
    if (c) await c.end().catch(() => {});
  }
}

function safeCall(fn: Subscriber, event: AuctionEvent) {
  try {
    fn(event);
  } catch (err) {
    console.error("[auctions:listen] subscriber failed", err);
  }
}

const g = globalThis as unknown as { qmAuctionListener?: AuctionListener };

/** The process-wide listener (survives dev hot reloads). */
export function auctionListener(): AuctionListener {
  g.qmAuctionListener ??= new AuctionListener();
  return g.qmAuctionListener;
}

/** Subscribe to committed changes of one auction. Returns the unsubscribe function. */
export function subscribeAuction(auctionId: string, fn: Subscriber): Promise<() => Promise<void>> {
  return auctionListener().subscribe(auctionId, fn);
}
