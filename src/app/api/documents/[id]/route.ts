import { connection } from "next/server";
import { currentUser } from "@/server/auth/guards";
import { getRequestTenant } from "@/server/tenant";
import { getStorage } from "@/server/media/storage";
import { contentDisposition, resolveDocumentAccess } from "@/server/provenance/documents";

export const runtime = "nodejs";

/*
 * GET /api/documents/[id] — download / view a provenance document.
 * Access (src/server/provenance/documents.ts resolveDocumentAccess):
 *   staff of the document's tenant → any document (no caching);
 *   anyone else → only public documents of ACTIVE/RESERVED/SOLD products, on that tenant's own host.
 * Everything else answers 404 (never 403), so private documents are not even confirmed to exist.
 */

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const [user, hostTenant] = await Promise.all([currentUser(), getRequestTenant()]);
  const access = await resolveDocumentAccess(id, { user, hostTenantId: hostTenant?.id ?? null });
  if (!access) return notFound();

  const object = await getStorage().get(access.document.storageKey);
  if (!object) return notFound();

  const isPdf = access.document.mimeType === "application/pdf";
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": access.document.mimeType,
      "Content-Length": String(object.size),
      "Content-Disposition": contentDisposition(access.document.title, access.document.mimeType),
      // Public documents may be made private again: keep them out of shared caches.
      "Cache-Control": access.via === "staff" ? "private, no-store" : "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      // `sandbox` would stop the browsers' built-in PDF viewers; PDFs are type-checked (%PDF-) on upload.
      "Content-Security-Policy": isPdf ? "frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
