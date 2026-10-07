import { revalidatePath } from "next/cache";
import { AuthError } from "@/server/auth/guards";
import { requireStaffContext } from "@/server/context";
import { addProductImages, MAX_FILES_PER_UPLOAD, type UploadFile } from "@/server/media/product-images";
import { MAX_UPLOAD_BYTES } from "@/server/media/images";
import { messageFromError } from "../_lib/errors";
import { copy, productEditPath } from "../_copy";
import { UPLOAD_TRANSPORT_MAX_BYTES, type UploadResponse } from "../_lib/limits";

/*
 * Photo upload: POST multipart/form-data with one or more `files` entries.
 *
 * Why a Route Handler and not a Server Action: Server Action bodies are capped at 1 MB unless
 * `experimental.serverActions.bodySizeLimit` is raised in next.config.ts (not ours to change), while
 * photos may be up to 25 MB (MAX_UPLOAD_BYTES). The client uploads one file per request so every
 * file gets its own progress / error, and each request stays under the proxy body buffer (see
 * ../_lib/limits.ts).
 *
 * Security: same checks as a Server Action — staff session + tenant (requireStaffContext) and a
 * same-origin check (route handlers have no built-in CSRF protection).
 */

function json(body: UploadResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Origin must match the host the request was made to (x-forwarded-host behind a proxy). */
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

export async function POST(request: Request, ctx: RouteContext<"/admin/inventory/[id]/images">) {
  if (!sameOrigin(request)) return json({ ok: false, message: copy.errors.forbidden }, 403);

  let staff;
  try {
    staff = await requireStaffContext();
  } catch (err) {
    if (err instanceof AuthError) {
      return json({ ok: false, message: err.code === "UNAUTHENTICATED" ? copy.errors.unauthenticated : copy.errors.forbidden }, err.code === "UNAUTHENTICATED" ? 401 : 403);
    }
    throw err;
  }

  const { id } = await ctx.params;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > UPLOAD_TRANSPORT_MAX_BYTES) {
    return json({ ok: false, message: copy.photos.tooLargeForTransport(Math.floor(UPLOAD_TRANSPORT_MAX_BYTES / 1024 / 1024)) }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, message: copy.photos.uploadFailed }, 400);
  }
  const entries = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (entries.length === 0) return json({ ok: false, message: copy.photos.uploadFailed }, 400);
  if (entries.length > MAX_FILES_PER_UPLOAD) {
    return json({ ok: false, message: `At most ${MAX_FILES_PER_UPLOAD} files per upload.` }, 400);
  }
  for (const f of entries) {
    if (f.size > MAX_UPLOAD_BYTES) {
      return json({ ok: false, message: `${f.name}: image exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` }, 413);
    }
  }

  const files: UploadFile[] = await Promise.all(
    entries.map(async (f) => ({ name: f.name.slice(0, 255), type: f.type.slice(0, 100), bytes: new Uint8Array(await f.arrayBuffer()) })),
  );

  try {
    const images = await addProductImages(staff, id, files);
    revalidatePath(productEditPath(id));
    revalidatePath("/admin/inventory");
    return json(
      { ok: true, images: images.map((i) => ({ id: i.id, url: i.urls.thumb, name: i.originalFilename ?? "photo", alt: i.alt })) },
      201,
    );
  } catch (err) {
    const message = messageFromError(err);
    return json({ ok: false, message }, 422);
  }
}
