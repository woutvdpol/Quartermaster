// Pure host normalization for TenantDomain (no DB / Next imports; unit-tested).

const HOST_RE = /^(?=.{1,253}(?::\d{1,5})?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

/**
 * Normalizes user input to a stored host: strips an http(s) scheme and a trailing slash,
 * lower-cases, drops a trailing dot. Rejects paths, credentials, queries, IP-less junk.
 * Returns null when invalid.
 */
export function normalizeDomainHost(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const host = s.replace(/\.$/, "") || null;
  if (!host || !HOST_RE.test(host)) return null;
  const port = host.split(":")[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return host;
}

