/**
 * Classifies IP addresses for outbound requests to user-supplied URLs (SSRF guard). Pure.
 *
 * Blocked: everything that is not a globally routable unicast address — loopback, private (RFC 1918,
 * ULA), link-local (incl. cloud metadata 169.254.169.254 / fd00:ec2::254), CGNAT, multicast, reserved,
 * documentation/benchmark ranges, "this network", broadcast, and IPv4 embedded in IPv6 (mapped,
 * compatible, NAT64, 6to4, Teredo) whose IPv4 part is blocked. Unparseable input is blocked too.
 */
import { isIP } from "node:net";

type Cidr4 = [number, number]; // [network as uint32, prefix length]

const BLOCKED_V4: Cidr4[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast (deprecated)
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
].map(([ip, len]) => [ipv4ToInt(ip as string)!, len as number]);

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inCidr4(ip: number, [net, len]: Cidr4): boolean {
  if (len === 0) return true;
  const mask = len === 32 ? 0xffffffff : (~0 << (32 - len)) >>> 0;
  return (ip & mask) >>> 0 === (net & mask) >>> 0;
}

export function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  return BLOCKED_V4.some((c) => inCidr4(n, c));
}

/** Expands an IPv6 address into 8 16-bit groups (handles "::" and a trailing dotted IPv4). */
export function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = ipv4ToInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [v4 >>> 16, v4 & 0xffff];
    s = s.slice(0, lastColon + 1) + "0:0"; // placeholder groups, replaced below
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups;
}

export function isBlockedIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true;
  const v4 = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  if (allZero(0, 8)) return true; // ::  unspecified
  if (allZero(0, 7) && g[7] === 1) return true; // ::1 loopback
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d → judge the IPv4 part.
  if (allZero(0, 5) && g[5] === 0xffff) return isBlockedIPv4(v4(g[6], g[7]));
  if (allZero(0, 6)) return isBlockedIPv4(v4(g[6], g[7]));
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 1 ? true : isBlockedIPv4(v4(g[6], g[7]));
  // 6to4 2002::/16 embeds an IPv4 address in groups 1–2.
  if (g[0] === 0x2002) return isBlockedIPv4(v4(g[1], g[2]));
  // Teredo 2001::/32 — the client IPv4 is obfuscated; block outright.
  if (g[0] === 0x2001 && g[1] === 0) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && allZero(1, 4)) return true; // discard-only 100::/64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // Only global unicast 2000::/3 is allowed.
  return (g[0] & 0xe000) !== 0x2000;
}

/** True when an outbound request to `ip` must be refused. Non-IP input → true. */
export function isBlockedAddress(ip: string): boolean {
  const s = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const kind = isIP(s.split("%")[0]);
  if (kind === 4) return isBlockedIPv4(s);
  if (kind === 6) return isBlockedIPv6(s);
  return true;
}
