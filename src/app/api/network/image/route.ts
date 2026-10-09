import { take } from "@/server/auth/rate-limit";
import { clientIpFromHeaders, isSameOrigin } from "@/server/request-meta";
import { visitorCountry } from "@/server/compliance/country";
import { normalizeHost } from "@/server/tenant";
import { SEARCH_IMAGE_MAX_BYTES, SearchImageError, SearchUnavailableError, decodeSearchImage } from "@/server/search";
import { searchNetworkByImage } from "@/server/network/service";
import { networkMount } from "@/lib/network";

/*
 * Photo search across the Quartermaster network (docs/network.md): POST multipart/form-data `file`
 * (JPEG/PNG/WebP ≤ 10 MB). Same rules as the shop's /api/search/image: processed in memory only, never
 * stored or logged; same-origin only; rate limited per IP and globally. Only on the host that serves the
 * network (PLATFORM_HOST or NETWORK_HOST); 404 elsewhere.
 */

const headers = { "Cache-Control": "private, no-store" };
const RATE = { limit: 20, windowMs: 10 * 60 * 1000 };
const GLOBAL_RATE = { limit: 1200, windowMs: 10 * 60 * 1000 };

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status, headers });
}

export async function POST(request: Request) {
  if (networkMount(normalizeHost(request.headers.get("host"))).kind !== "serve") return error(404, "not_found", "Not found");
  if (!isSameOrigin(request)) return error(403, "bad_request", "Forbidden");

  const lengthHeader = request.headers.get("content-length");
  const length = Number(lengthHeader);
  if (!lengthHeader || !Number.isFinite(length) || length < 0) return error(411, "bad_request", "Length required");
  if (length > SEARCH_IMAGE_MAX_BYTES + 64 * 1024) return error(413, "too_large", "The photo is too large (max 10 MB).");

  const ip = clientIpFromHeaders(request.headers) ?? "unknown";
  if (!(await take(`network:image:ip:${ip}`, RATE)) || !(await take("network:image:all", GLOBAL_RATE))) {
    return error(429, "rate_limited", "Too many photo searches. Try again in a few minutes.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error(400, "bad_request", "Expected multipart form data");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return error(400, "bad_request", "Missing photo");
  if (file.size > SEARCH_IMAGE_MAX_BYTES) return error(413, "too_large", "The photo is too large (max 10 MB).");

  try {
    const image = await decodeSearchImage(new Uint8Array(await file.arrayBuffer()));
    const res = await searchNetworkByImage(image, visitorCountry(request.headers));
    return Response.json({ items: res.items, total: res.items.length }, { headers });
  } catch (err) {
    if (err instanceof SearchImageError) return error(err.code === "too_large" ? 413 : 422, err.code, err.message);
    if (err instanceof SearchUnavailableError) return error(503, "unavailable", err.message);
    console.error("[network/image] failed:", err instanceof Error ? err.message : err);
    return error(500, "unavailable", "Photo search failed");
  }
}
