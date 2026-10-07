import { deleteDraftPhoto, uploadLeadPhoto, LEAD_PHOTO_MAX_BYTES } from "@/server/leads";
import { getRequestTenant } from "@/server/tenant";
import { leadsCopy } from "@/components/shop/leads/_copy";
import type { LeadUploadResponse } from "@/components/shop/leads/types";

/*
 * Direct photo upload for the "Sell your collection" form (POST multipart: `draft` + one `file`).
 * Route Handler, not a Server Action: one request per photo gives per-file progress/errors.
 * Security: same-origin check (no built-in CSRF for route handlers), shop host only, signed draft
 * token (src/server/leads/draft.ts), rate limits per IP and per draft, magic-byte check + sharp
 * re-encode (src/server/leads/photos.ts). DELETE (JSON `{draft, file}`) removes an unsent photo.
 */

const MB = LEAD_PHOTO_MAX_BYTES / 1024 / 1024;
const t = leadsCopy.errors;

function json(body: LeadUploadResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, message: t.unexpected }, 403);
  const tenant = await getRequestTenant();
  if (!tenant) return json({ ok: false, message: t.unexpected }, 404);

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LEAD_PHOTO_MAX_BYTES + 64 * 1024) return json({ ok: false, message: t.tooLarge("The photo", MB) }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, message: t.unexpected }, 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ ok: false, message: t.unexpected }, 400);
  const name = file.name.slice(0, 120) || "photo";
  if (file.size > LEAD_PHOTO_MAX_BYTES) return json({ ok: false, message: t.tooLarge(name, MB) }, 413);

  try {
    const res = await uploadLeadPhoto({
      tenantId: tenant.id,
      draftToken: form.get("draft"),
      bytes: new Uint8Array(await file.arrayBuffer()),
      ip: clientIp(request),
    });
    if (res.ok) return json({ ok: true, photo: res.photo }, 201);
    if (res.error === "expired") return json({ ok: false, message: t.expired }, 410);
    if (res.error === "rate_limited") return json({ ok: false, message: t.rate_limited }, 429);
    return json({ ok: false, message: res.message ? `${name}: ${res.message}` : t.wrongType(name) }, 422);
  } catch (error) {
    console.error("[sell/upload] failed:", error);
    return json({ ok: false, message: t.uploadFailed(name) }, 500);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const tenant = await getRequestTenant();
  if (!tenant) return new Response(null, { status: 404 });
  let body: { draft?: unknown; file?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body.file !== "string") return new Response(null, { status: 400 });
  const ok = await deleteDraftPhoto({ tenantId: tenant.id, draftToken: body.draft, file: body.file });
  return new Response(null, { status: ok ? 204 : 404, headers: { "Cache-Control": "no-store" } });
}
