import "server-only";
import { take, type RateLimitRule } from "@/server/auth/rate-limit";
import { clientIpFromHeaders } from "@/server/request-meta";

/*
 * Receiver for CSP violation reports (src/lib/csp.ts, review R2). Accepts both formats browsers send:
 *  - `application/csp-report`    (report-uri; Firefox, Safari):  {"csp-report": {...}}
 *  - `application/reports+json`  (report-to / Reporting API; Chrome): [{type: "csp-violation", body: {...}}]
 * Logs one compact line per violation: disposition, directive, blocked origin (or keyword such as
 * "inline"/"eval"), document path without query. Nothing else from the report (no full URLs, no
 * script samples, no IP/UA). No DB table — the log is the sink.
 */

export const CSP_REPORT_MAX_BYTES = 16 * 1024;
export const CSP_REPORT_MAX_PER_REQUEST = 10;
/** Per client IP (shared "unknown" bucket when the IP is not trusted, see request-meta.ts). */
export const CSP_REPORT_RATE_LIMIT: RateLimitRule = { limit: 30, windowMs: 60 * 1000 };

const ACCEPTED_TYPES = new Set(["application/csp-report", "application/reports+json", "application/json"]);

export type CspViolation = {
  disposition: string;
  directive: string;
  blocked: string;
  path: string;
};

function str(value: unknown, max = 2048): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Origin of a blocked URL, or the keyword the browser reported ("inline", "eval", "data", …). */
export function blockedOrigin(raw: string): string {
  const value = raw.trim();
  if (!value) return "-";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:") return url.origin;
    return url.protocol.replace(/:$/, ""); // data:, blob:, chrome-extension: …
  } catch {
    return value.replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "-"; // "inline", "eval", "wasm-eval", "trusted-types-policy"
  }
}

/** Path of the document URL (no query/fragment — may carry tokens). */
export function documentPath(raw: string): string {
  try {
    return new URL(raw).pathname.slice(0, 200);
  } catch {
    return "-";
  }
}

function directiveName(raw: string): string {
  // Older browsers send the full directive ("script-src 'self' …"); keep only its name.
  return raw.trim().split(/\s+/)[0]?.replace(/[^a-z-]/gi, "").slice(0, 40) || "-";
}

/** Normalises a parsed report payload (either format) to compact violations. Unknown shapes → []. */
export function parseCspReports(payload: unknown): CspViolation[] {
  const out: CspViolation[] = [];
  if (Array.isArray(payload)) {
    for (const item of payload.slice(0, CSP_REPORT_MAX_PER_REQUEST)) {
      if (!item || typeof item !== "object") continue;
      const { type, body } = item as { type?: unknown; body?: unknown };
      if (type !== "csp-violation" || !body || typeof body !== "object") continue;
      const b = body as Record<string, unknown>;
      out.push({
        disposition: str(b.disposition) === "enforce" ? "enforce" : "report",
        directive: directiveName(str(b.effectiveDirective) || str(b.violatedDirective)),
        blocked: blockedOrigin(str(b.blockedURL)),
        path: documentPath(str(b.documentURL) || str((item as { url?: unknown }).url)),
      });
    }
    return out;
  }
  if (payload && typeof payload === "object" && "csp-report" in payload) {
    const r = (payload as Record<string, unknown>)["csp-report"];
    if (!r || typeof r !== "object") return out;
    const b = r as Record<string, unknown>;
    out.push({
      disposition: str(b.disposition) === "enforce" ? "enforce" : "report",
      directive: directiveName(str(b["effective-directive"]) || str(b["violated-directive"])),
      blocked: blockedOrigin(str(b["blocked-uri"])),
      path: documentPath(str(b["document-uri"])),
    });
  }
  return out;
}

export function formatViolation(v: CspViolation): string {
  return `[csp] ${v.disposition} ${v.directive} blocked=${v.blocked} doc=${v.path}`;
}

/** Reads at most `max` bytes of the body; null when it is larger. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

const noContent = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function handleCspReport(request: Request, log: (line: string) => void = console.warn): Promise<Response> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.has(type)) return noContent(415);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > CSP_REPORT_MAX_BYTES) return noContent(413);

  const ip = clientIpFromHeaders(request.headers);
  if (!(await take(`csp-report:${ip ?? "unknown"}`, CSP_REPORT_RATE_LIMIT))) return noContent(429);

  const text = await readCapped(request, CSP_REPORT_MAX_BYTES);
  if (text === null) return noContent(413);

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return noContent(400);
  }
  for (const v of parseCspReports(payload)) log(formatViolation(v));
  return noContent();
}
