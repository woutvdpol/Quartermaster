/*
 * Packet-level network emulation for realistic lab measurements (docs/perf/round3.md § Meetmethode).
 *
 *   npx next start -p 3002                 # the production server, on a side port
 *   npm run perf:netem                     # listens on :3001 (the demo tenant's domain) → https + h2
 *   PERF_LH_THROTTLING=packet npm run perf:lighthouse
 *
 * Why: Lighthouse's "devtools" throttling adds its latency (562.5 ms on mobile) to EVERY request. That
 * latency is meant to stand in for DNS + TCP + TLS + request on a cold connection, but the image that
 * is discovered in the first HTML bytes pays it a second time, although in production it travels over
 * the already open HTTP/2 connection. So any page whose LCP is a separate request has a floor of
 * 2 × 562 ms there. This proxy instead models the network like a real link (as WebPageTest does):
 *
 *   browser ──TCP──▶ :3001 shaper (RTT, shared down/up bandwidth, +1 RTT TCP handshake)
 *                     ──▶ TLS 1.3 + HTTP/2 terminator (self-signed; Chrome runs with --ignore-certificate-errors)
 *                        ──HTTP/1.1 keep-alive──▶ next start on :3002 (Host header unchanged → tenant resolves)
 *
 * So a cold page load pays TCP (1 RTT) + TLS (1 RTT) + request (1 RTT) + transfer at link speed, and
 * every following request on the same connection 1 RTT + transfer — like ingress-nginx in production.
 * Not modelled: DNS, TCP slow start, packet loss. Defaults = Lighthouse's mobile profile
 * (150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up); desktop profile: PERF_NET_RTT=40 PERF_NET_DOWN_KBPS=10240.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";

const LISTEN = Number(process.env.PERF_NET_PORT ?? 3001);
const UPSTREAM = Number(process.env.PERF_NET_UPSTREAM ?? 3002);
const RTT = Number(process.env.PERF_NET_RTT ?? 150);
const DOWN_KBPS = Number(process.env.PERF_NET_DOWN_KBPS ?? 1638.4);
const UP_KBPS = Number(process.env.PERF_NET_UP_KBPS ?? 750);
const PACKET = 1460;

// ─── Certificate (self-signed, cached in .local) ─────────────────────────────

const certDir = join(process.cwd(), ".local", "perf", "netem-cert");
const keyFile = join(certDir, "key.pem");
const certFile = join(certDir, "cert.pem");
if (!existsSync(keyFile) || !existsSync(certFile)) {
  mkdirSync(certDir, { recursive: true });
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "365",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });
}

// ─── TLS + HTTP/2 terminator → next start ────────────────────────────────────

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "http2-settings", "te"]);
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

const tlsServer = http2.createSecureServer({ key: readFileSync(keyFile), cert: readFileSync(certFile), allowHTTP1: true }, (req, res) => {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith(":") || HOP_BY_HOP.has(k) || v === undefined) continue;
    headers[k] = v;
  }
  headers.host = (req.headers[":authority"] as string | undefined) ?? req.headers.host;
  headers["x-forwarded-proto"] = "https";
  const upstream = http.request({ host: "127.0.0.1", port: UPSTREAM, method: req.method, path: req.url, headers, agent }, (up) => {
    const out: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(k) && v !== undefined) out[k] = v;
    res.writeHead(up.statusCode ?? 502, out);
    up.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
tlsServer.on("sessionError", () => {});

// ─── Link shaper ─────────────────────────────────────────────────────────────

/** One direction of the shared link: packets are serialised at `kbps`, then delivered after RTT/2. */
class Link {
  private busyUntil = 0;
  constructor(private readonly kbps: number) {}
  /** Delivery time (ms, performance.now clock) of a packet of `bytes` handed to the link at `now`. */
  schedule(bytes: number, now: number): number {
    const start = Math.max(now, this.busyUntil);
    this.busyUntil = start + (this.kbps > 0 ? (bytes * 8) / this.kbps : 0);
    return this.busyUntil + RTT / 2;
  }
}
const down = new Link(DOWN_KBPS);
const up = new Link(UP_KBPS);

/** Pipes `from` → `to` through `link`, in order; `firstDelay` models the TCP handshake (client side). */
function shapedPipe(from: net.Socket, to: net.Socket, link: Link, firstDelay: number) {
  const queue: Array<{ at: number; data: Buffer | null }> = [];
  let timer: NodeJS.Timeout | null = null;
  const notBefore = performance.now() + firstDelay;
  const flush = () => {
    timer = null;
    const now = performance.now();
    while (queue.length && queue[0].at <= now + 0.5) {
      const { data } = queue.shift()!;
      if (data === null) to.end();
      else if (!to.destroyed) to.write(data);
    }
    if (queue.length) timer = setTimeout(flush, Math.max(0, queue[0].at - now));
  };
  const push = (at: number, data: Buffer | null) => {
    queue.push({ at, data });
    if (!timer) timer = setTimeout(flush, Math.max(0, queue[0].at - performance.now()));
  };
  from.on("data", (chunk: Buffer) => {
    const now = Math.max(performance.now(), notBefore);
    for (let i = 0; i < chunk.length; i += PACKET) {
      const piece = chunk.subarray(i, i + PACKET);
      push(link.schedule(piece.length, now), piece);
    }
  });
  from.on("end", () => push(Math.max(performance.now() + RTT / 2, queue.at(-1)?.at ?? 0), null));
  from.on("error", () => to.destroy());
}

const shaper = net.createServer((client) => {
  client.setNoDelay(true);
  const server = net.connect({ host: "127.0.0.1", port: (tlsServer.address() as net.AddressInfo).port });
  server.setNoDelay(true);
  shapedPipe(client, server, up, RTT); // the client's first bytes wait for the SYN/SYN-ACK round trip
  shapedPipe(server, client, down, 0);
  server.on("close", () => client.destroy());
  client.on("close", () => server.destroy());
});

tlsServer.listen(0, "127.0.0.1", () => {
  shaper.listen(LISTEN, () => {
    console.log(
      `netem: https://localhost:${LISTEN} → next on :${UPSTREAM} · RTT ${RTT} ms · down ${DOWN_KBPS} kbit/s · up ${UP_KBPS} kbit/s (h2, TLS 1.3)`,
    );
  });
});
