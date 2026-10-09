import { take } from "@/server/auth/rate-limit";
import { clientIpFromHeaders, isSameOrigin } from "@/server/request-meta";
import { SEARCH_IMAGE_MAX_BYTES, SearchImageError, SearchUnavailableError, decodeSearchImage, searchByImage, searchRequestContext, toPublicCards } from "@/server/search";
import { servedLocaleParam } from "@/lib/i18n/shop-locales";
import { translateCards } from "@/server/storefront/translate";
import type { ImageSearchResponse, SearchErrorResponse } from "@/server/search/api-types";
import { matchLevel } from "@/server/search/ui-labels";
import { MAX_QUERY_LENGTH, parseCatalogParams } from "@/server/storefront-catalog";

/*
 * Photo search ("lijkt hierop"): POST multipart/form-data
 *   file  the photo (JPEG/PNG/WebP, ≤ 10 MB; phone camera/paste/upload)
 *   q     optional text refinement ("met adelaar")
 *   f, min, max, page   optional catalog filters (same meaning as on /shop)
 *
 * The photo is processed in memory only (decoded + resized to the model input, then dropped) —
 * never stored or logged. Same-origin only; rate limited per IP with the atomic DB limiter (photo
 * search costs ~60 ms CPU per call). Shop hosts only; 404 while "coming soon" for visitors.
 */

const headers = { "Cache-Control": "private, no-store" };
const RATE = { limit: 20, windowMs: 10 * 60 * 1000 };
const TENANT_RATE = { limit: 600, windowMs: 10 * 60 * 1000 };

function error(status: number, body: SearchErrorResponse) {
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return error(403, { error: "bad_request", message: "Forbidden" });
  const ctx = await searchRequestContext();
  if (!ctx) return error(404, { error: "not_found", message: "Not found" });

  // Public route: refuse unbounded (chunked) bodies before formData() buffers them.
  const lengthHeader = request.headers.get("content-length");
  const length = Number(lengthHeader);
  if (!lengthHeader || !Number.isFinite(length) || length < 0) return error(411, { error: "bad_request", message: "Length required" });
  if (length > SEARCH_IMAGE_MAX_BYTES + 64 * 1024) return error(413, { error: "too_large", message: "The photo is too large (max 10 MB)." });

  const tenantId = ctx.shop.tenant.id;
  const ip = clientIpFromHeaders(request.headers) ?? "unknown";
  if (!(await take(`search:image:ip:${tenantId}:${ip}`, RATE)) || !(await take(`search:image:tenant:${tenantId}`, TENANT_RATE))) {
    return error(429, { error: "rate_limited", message: "Too many photo searches. Try again in a few minutes." });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error(400, { error: "bad_request", message: "Expected multipart form data" });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return error(400, { error: "bad_request", message: "Missing photo" });
  if (file.size > SEARCH_IMAGE_MAX_BYTES) return error(413, { error: "too_large", message: "The photo is too large (max 10 MB)." });

  const raw: Record<string, string | string[]> = { f: form.getAll("f").filter((v): v is string => typeof v === "string") };
  for (const k of ["min", "max", "page"] as const) {
    const v = form.get(k);
    if (typeof v === "string") raw[k] = v;
  }
  const params = parseCatalogParams(raw);
  const qRaw = form.get("q");
  const q = typeof qRaw === "string" ? qRaw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH) : "";

  try {
    const image = await decodeSearchImage(new Uint8Array(await file.arrayBuffer()));
    const res = await searchByImage(tenantId, image, {
      q,
      filters: { facets: params.facets, min: params.min, max: params.max },
      page: params.page,
      scope: ctx.scope,
      currency: ctx.shop.tenant.currency,
    });
    const body: ImageSearchResponse = {
      // `locale` (form field or query, the shop UI's language): approved translated titles (docs/i18n.md).
      items: (await toPublicCards(ctx, await translateCards(tenantId, servedLocaleParam(String(form.get("locale") ?? new URL(request.url).searchParams.get("locale") ?? ""), ctx.shop.locales), res.items))).map((c) => ({ ...c, match: matchLevel(res.scores?.[c.id]) })),
      total: res.total,
      page: res.page,
      pageSize: res.pageSize,
      interpretation: res.interpretation,
      timing: { totalMs: res.timing.totalMs, imageMs: res.timing.imageMs },
    };
    return Response.json(body, { headers: { ...headers, "Server-Timing": `search;dur=${res.timing.totalMs}` } });
  } catch (err) {
    if (err instanceof SearchImageError) return error(err.code === "too_large" ? 413 : 422, { error: err.code, message: err.message });
    if (err instanceof SearchUnavailableError) return error(503, { error: "unavailable", message: err.message });
    console.error("[search/image] failed:", err instanceof Error ? err.message : err);
    return error(500, { error: "unavailable", message: "Photo search failed" });
  }
}
