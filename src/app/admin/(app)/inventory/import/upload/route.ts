import { AuthError } from "@/server/auth/guards";
import { ServiceError, requireStaffContext } from "@/server/context";
import { isSameOrigin } from "@/server/request-meta";
import { IMPORT_SOURCES, MAX_IMPORT_FILE_BYTES, createImportJob, type ImportSourceName } from "@/server/import";
import type { ImportUploadResponse } from "@/server/import/types";
import { importCopy as t } from "@/components/admin/import/copy";

/*
 * Import file upload: POST multipart/form-data { source: WOOCOMMERCE | SHOPIFY, file: <csv> }.
 * Returns { ok: true, job } (status UPLOADED, with the preview) or { ok: false, message }.
 *
 * A route handler (like the product photo upload) so the 20 MB limit is checked before the body is
 * read and the client gets a JSON answer. Security: staff session + tenant (requireStaffContext) and a
 * same-origin check (route handlers have no built-in CSRF protection). The file is stored privately
 * (`{tenantId}/imports/….csv` is never served by /uploads — .csv is not a servable extension).
 */

// multipart overhead on top of the file itself
const TRANSPORT_MAX = MAX_IMPORT_FILE_BYTES + 64 * 1024;

function json(body: ImportUploadResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ ok: false, message: t.errors.forbidden }, 403);
  let ctx;
  try {
    ctx = await requireStaffContext();
  } catch (err) {
    if (err instanceof AuthError) {
      const unauth = err.code === "UNAUTHENTICATED";
      return json({ ok: false, message: unauth ? t.errors.unauthenticated : t.errors.forbidden }, unauth ? 401 : 403);
    }
    throw err;
  }

  const mb = MAX_IMPORT_FILE_BYTES / 1024 / 1024;
  if (Number(request.headers.get("content-length") ?? 0) > TRANSPORT_MAX) return json({ ok: false, message: t.file.tooLarge(mb) }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, message: t.file.failed }, 400);
  }
  const source = form.get("source");
  const file = form.get("file");
  if (typeof source !== "string" || !(IMPORT_SOURCES as readonly string[]).includes(source)) return json({ ok: false, message: t.errors.generic }, 400);
  if (!file || typeof file === "string") return json({ ok: false, message: t.file.required }, 400);
  if (file.size > MAX_IMPORT_FILE_BYTES) return json({ ok: false, message: t.file.tooLarge(mb) }, 413);

  try {
    const job = await createImportJob(ctx, {
      source: source as ImportSourceName,
      fileName: file.name || "import.csv",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return json({ ok: true, job }, 200);
  } catch (err) {
    if (err instanceof ServiceError) return json({ ok: false, message: err.message }, err.code === "NOT_FOUND" ? 404 : 422);
    console.error("[inventory/import/upload]", err);
    return json({ ok: false, message: t.errors.generic }, 500);
  }
}
