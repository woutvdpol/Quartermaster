import "server-only";
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { isBlockedAddress } from "./ip-ranges";

/*
 * SSRF-safe HTTP GET for user-supplied URLs (product photo URLs in import files).
 *
 *  - http/https only, no credentials in the URL, default ports only (configurable).
 *  - DNS is resolved up front; EVERY resolved address must be public (ip-ranges.ts), and the socket is
 *    pinned to the checked address (custom `lookup`), so DNS rebinding between check and connect is
 *    impossible. IP-literal hosts are checked the same way.
 *  - Redirects are followed manually (max 3); each hop is checked again.
 *  - Overall timeout, response size cap (Content-Length and streamed bytes), Content-Type allow-list.
 *  - No connection reuse (agent: false), no proxy, no decompression (Accept-Encoding: identity).
 */

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "BLOCKED_ADDRESS"
  | "DNS"
  | "TOO_MANY_REDIRECTS"
  | "HTTP_STATUS"
  | "CONTENT_TYPE"
  | "TOO_LARGE"
  | "TIMEOUT"
  | "NETWORK";

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Allowed ports; null = any. Default [80, 443] (+ the scheme default when the URL has none). */
  ports?: number[] | null;
  /** Accept the (lower-cased, parameter-free) Content-Type. */
  acceptContentType?: (contentType: string) => boolean;
  /** DNS resolver (tests). Default: the system resolver, all addresses. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Address policy (tests). Default: !isBlockedAddress. */
  isAllowedAddress?: (ip: string) => boolean;
  signal?: AbortSignal;
  userAgent?: string;
};

export type SafeFetchResult = { bytes: Uint8Array; contentType: string; finalUrl: string };

export const IMAGE_CONTENT_TYPE = (ct: string) => ct.startsWith("image/") && !ct.includes("svg");

const DEFAULTS = {
  maxBytes: 15 * 1024 * 1024,
  timeoutMs: 20_000,
  maxRedirects: 3,
  ports: [80, 443] as number[] | null,
  userAgent: "QuartermasterImport/1.0 (+product photo import)",
};

async function systemResolve(hostname: string): Promise<ResolvedAddress[]> {
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
}

/** Validates a URL for an outbound request (scheme, credentials, port). Exported for tests. */
export function checkOutboundUrl(raw: string, ports: number[] | null = DEFAULTS.ports): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("INVALID_URL", "Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("INVALID_URL", "Only http and https URLs are allowed");
  if (url.username || url.password) throw new SafeFetchError("INVALID_URL", "URLs with credentials are not allowed");
  if (!url.hostname) throw new SafeFetchError("INVALID_URL", "URL has no host");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (ports && !ports.includes(port)) throw new SafeFetchError("INVALID_URL", `Port ${port} is not allowed`);
  return url;
}

async function resolveChecked(url: URL, opts: Required<Pick<SafeFetchOptions, "resolve" | "isAllowedAddress">>): Promise<ResolvedAddress> {
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  let addresses: ResolvedAddress[];
  const literal = isIP(host);
  if (literal) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await opts.resolve(host);
    } catch {
      throw new SafeFetchError("DNS", `Host “${host}” could not be resolved`);
    }
  }
  if (addresses.length === 0) throw new SafeFetchError("DNS", `Host “${host}” has no address`);
  // All of them: a name that resolves to one public and one private address is refused.
  for (const a of addresses) {
    if (!opts.isAllowedAddress(a.address)) throw new SafeFetchError("BLOCKED_ADDRESS", `Host “${host}” resolves to a non-public address`);
  }
  return addresses[0];
}

type Hop = { status: number; location: string | null; contentType: string; res: http.IncomingMessage };

function request(url: URL, pinned: ResolvedAddress, opts: { userAgent: string; signal: AbortSignal }): Promise<Hop> {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      callback(null, pinned.address, pinned.family);
    }
  };
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup,
        signal: opts.signal,
        headers: { "User-Agent": opts.userAgent, Accept: "image/*", "Accept-Encoding": "identity" },
      },
      (res) => {
        const ct = String(res.headers["content-type"] ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null, contentType: ct, res });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function readBody(res: http.IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    res.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        fail(new SafeFetchError("TOO_LARGE", `Response exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`));
        res.destroy();
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    res.on("error", fail);
    res.on("aborted", () => fail(new SafeFetchError("NETWORK", "Connection aborted")));
  });
}

/** GETs `rawUrl` under the SSRF rules above. Throws SafeFetchError. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const ports = options.ports === undefined ? DEFAULTS.ports : options.ports;
  const accept = options.acceptContentType ?? IMAGE_CONTENT_TYPE;
  const policy = { resolve: options.resolve ?? systemResolve, isAllowedAddress: options.isAllowedAddress ?? ((ip: string) => !isBlockedAddress(ip)) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULTS.timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    let url = checkOutboundUrl(rawUrl, ports);
    for (let redirects = 0; ; redirects++) {
      const pinned = await resolveChecked(url, policy);
      let hop: Hop;
      try {
        hop = await request(url, pinned, { userAgent: options.userAgent ?? DEFAULTS.userAgent, signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT", "Request timed out");
        throw new SafeFetchError("NETWORK", `Download failed: ${(err as Error).message}`);
      }
      if (hop.status >= 300 && hop.status < 400 && hop.location) {
        hop.res.resume(); // discard the redirect body
        if (redirects >= maxRedirects) throw new SafeFetchError("TOO_MANY_REDIRECTS", `More than ${maxRedirects} redirects`);
        let next: string;
        try {
          next = new URL(hop.location, url).toString();
        } catch {
          throw new SafeFetchError("INVALID_URL", "Invalid redirect target");
        }
        url = checkOutboundUrl(next, ports);
        continue;
      }
      if (hop.status !== 200) {
        hop.res.resume();
        throw new SafeFetchError("HTTP_STATUS", `HTTP ${hop.status}`);
      }
      if (!accept(hop.contentType)) {
        hop.res.destroy();
        throw new SafeFetchError("CONTENT_TYPE", `Unexpected content type “${hop.contentType || "none"}”`);
      }
      const length = Number(hop.res.headers["content-length"] ?? NaN);
      if (Number.isFinite(length) && length > maxBytes) {
        hop.res.destroy();
        throw new SafeFetchError("TOO_LARGE", `Response exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
      }
      try {
        const bytes = await readBody(hop.res, maxBytes);
        return { bytes, contentType: hop.contentType, finalUrl: url.toString() };
      } catch (err) {
        if (err instanceof SafeFetchError) throw err;
        if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT", "Request timed out");
        throw new SafeFetchError("NETWORK", `Download failed: ${(err as Error).message}`);
      }
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}
